using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using BepInEx;
using BepInEx.Configuration;
using BepInEx.Logging;
using HarmonyLib;
using Newtonsoft.Json;

namespace GearSolverCapture
{
    /// <summary>
    /// Gear Solver capture source for the OUTERPLANE Steam client.
    ///
    /// The game talks to its servers through <c>CWebManager</c> (BestHTTP/2 +
    /// a repeating-key XOR on the body). Two hooks, both read-only:
    ///
    ///  1. <c>CWebManager.Log2InternalWeb(string message, string cmd, bool request)</c>
    ///     — an empty logging stub the devs left in, called on every successful
    ///     response with the DECRYPTED JSON and the request path ("/user/item").
    ///     That's the primary hook: exact path → exact file name.
    ///  2. <c>CWebManager.DecryptMsg(string)</c> — the static decoder every
    ///     response goes through. Fallback only: if hook 1 never fires (the stub
    ///     is tiny and Mono's JIT may inline it into its caller), we identify the
    ///     payload by its top-level keys instead of the path.
    ///
    /// Nothing is modified, nothing is sent: the postfixes copy a string to disk
    /// and return. Every hook body is wrapped so a plugin bug can never bubble
    /// into the game's network callback.
    ///
    /// Output mirrors tools/capture/addon.py: <c>user_item.json</c>,
    /// <c>user_character.json</c>, … plus a <c>.captured</c> sentinel once the
    /// inventory landed, unknown endpoints under <c>_unknown/</c>, and a
    /// <c>.steam-plugin.json</c> heartbeat the desktop app reads to show
    /// "plugin live".
    /// </summary>
    [BepInPlugin(Id, Name, Version)]
    public sealed class Plugin : BaseUnityPlugin
    {
        public const string Id = "outerpedia.gearsolver.capture";
        public const string Name = "Gear Solver Capture";
        public const string Version = "0.1.0";

        internal static ManualLogSource Log;

        private void Awake()
        {
            Log = Logger;
            var enabled = Config.Bind("Capture", "Enabled", true,
                "Write decoded game responses to OutDir. Off = the plugin loads but does nothing.");
            var outDir = Config.Bind("Capture", "OutDir", "",
                "Folder where the decoded snapshots are written (user_item.json, user_character.json, ...). " +
                "Empty = %APPDATA%\\Outerpedia Gear Solver\\capture-out. The Gear Solver app fills this in when it installs the plugin.");
            var keepUnknown = Config.Bind("Capture", "KeepUnknown", true,
                "Also keep endpoints the solver doesn't use yet, under OutDir/_unknown/ (handy to discover new game endpoints).");

            if (!enabled.Value)
            {
                Log.LogInfo($"{Name} {Version} — disabled by config.");
                return;
            }

            string dir;
            try
            {
                dir = Sink.ResolveOutDir(outDir.Value);
                Directory.CreateDirectory(dir);
            }
            catch (Exception e)
            {
                Log.LogError($"cannot create OutDir '{outDir.Value}': {e.Message} — capture disabled.");
                return;
            }

            Sink.Init(dir, keepUnknown.Value);
            Hooks.Apply();
            Log.LogInfo($"{Name} {Version} — writing to {dir}");
        }
    }

    /// <summary>Harmony patches. Reflection by name (no compile-time reference
    /// to Assembly-CSharp) so a renamed method logs an error instead of
    /// throwing a TypeLoadException and taking the plugin down.</summary>
    internal static class Hooks
    {
        /// <summary>True once Log2InternalWeb has fired at least once — from
        /// then on the shape-based fallback stays silent.</summary>
        internal static volatile bool PathHookFired;

        public static void Apply()
        {
            var harmony = new Harmony(Plugin.Id);
            var mgr = AccessTools.TypeByName("CWebManager");
            if (mgr == null)
            {
                Plugin.Log.LogError("CWebManager not found — the game changed; capture disabled.");
                return;
            }

            var log2 = AccessTools.Method(mgr, "Log2InternalWeb", new[] { typeof(string), typeof(string), typeof(bool) });
            if (log2 != null)
            {
                harmony.Patch(log2, postfix: new HarmonyMethod(typeof(Hooks), nameof(AfterLog2InternalWeb)));
                Plugin.Log.LogInfo("hooked CWebManager.Log2InternalWeb (path-aware).");
            }
            else Plugin.Log.LogWarning("CWebManager.Log2InternalWeb not found — relying on the DecryptMsg fallback.");

            var decrypt = AccessTools.Method(mgr, "DecryptMsg", new[] { typeof(string) });
            if (decrypt != null)
            {
                harmony.Patch(decrypt, postfix: new HarmonyMethod(typeof(Hooks), nameof(AfterDecryptMsg)));
                Plugin.Log.LogInfo("hooked CWebManager.DecryptMsg (shape fallback).");
            }
            else if (log2 == null)
            {
                Plugin.Log.LogError("neither hook target exists — capture disabled.");
            }
        }

        // Parameter names MUST match the original signature for Harmony to bind them.
        private static void AfterLog2InternalWeb(string message, string cmd, bool request)
        {
            try
            {
                if (request) return;          // outgoing payload — we only want responses
                PathHookFired = true;
                Sink.Capture(cmd, message);
            }
            catch (Exception e)
            {
                Plugin.Log.LogError($"Log2InternalWeb hook: {e}");
            }
        }

        private static void AfterDecryptMsg(string __result)
        {
            try
            {
                if (PathHookFired) return;
                Sink.CaptureByShape(__result);
            }
            catch (Exception e)
            {
                Plugin.Log.LogError($"DecryptMsg hook: {e}");
            }
        }
    }

    /// <summary>File writer. All disk I/O happens on the thread pool (the hooks
    /// run inside the game's main-thread network callback; a 5 MB inventory
    /// write would otherwise hitch a frame), serialized by one lock so files
    /// are never interleaved.</summary>
    internal static class Sink
    {
        /// <summary>Exact response path → output basename. Same table as
        /// tools/capture/addon.py — keep them in sync.</summary>
        private static readonly Dictionary<string, string> Want = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            { "/user/item", "user_item" },
            { "/user/character", "user_character" },
            { "/user/asset", "user_asset" },
            { "/user/info", "user_info" },
            { "/user/lobby", "user_lobby" },
            { "/user/etc", "user_etc" },
            { "/item/customInfo", "item_customInfo" },
            { "/archive/info", "user_archive" },
            { "/gift/info", "user_gift" },
        };

        /// <summary>Login / heartbeat noise never worth keeping.</summary>
        private static readonly string[] IgnorePrefixes = { "/account/", "/server/" };

        private static readonly object Gate = new object();
        private static readonly HashSet<string> SeenPaths = new HashSet<string>(StringComparer.Ordinal);
        private static readonly Dictionary<string, int> LastHash = new Dictionary<string, int>(StringComparer.Ordinal);
        private static string _dir;
        private static bool _keepUnknown;
        private static readonly string StartedAt = DateTime.UtcNow.ToString("o");
        private static int _captures;
        private static string _lastPath;
        private static string _lastAt;

        public static string ResolveOutDir(string configured)
        {
            var v = (configured ?? "").Trim();
            if (v.Length == 0)
            {
                v = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Outerpedia Gear Solver", "capture-out");
            }
            return Path.GetFullPath(Environment.ExpandEnvironmentVariables(v));
        }

        public static void Init(string dir, bool keepUnknown)
        {
            _dir = dir;
            _keepUnknown = keepUnknown;
            ThreadPool.QueueUserWorkItem(_ => { lock (Gate) WriteHeartbeat(); });
        }

        /// <summary>Path-aware capture (primary hook).</summary>
        public static void Capture(string path, string json)
        {
            if (_dir == null || string.IsNullOrEmpty(json) || string.IsNullOrEmpty(path)) return;
            if (LooksEncrypted(json)) return;   // error branch hands us the raw {"msg":"<hex>"} body
            if (path[0] != '/') path = "/" + path;
            var q = path.IndexOf('?');
            if (q >= 0) path = path.Substring(0, q);

            string name;
            if (!Want.TryGetValue(path, out name))
            {
                foreach (var p in IgnorePrefixes) if (path.StartsWith(p, StringComparison.Ordinal)) return;
                if (!_keepUnknown) return;
                name = null;
            }
            var p2 = path;
            ThreadPool.QueueUserWorkItem(_ =>
            {
                lock (Gate)
                {
                    try
                    {
                        NoteSeen(p2);
                        if (name != null) WriteKnown(name, json, p2);
                        else WriteUnknown(p2, json);
                    }
                    catch (Exception e)
                    {
                        Plugin.Log.LogError($"write {p2}: {e.Message}");
                    }
                }
            });
        }

        /// <summary>Shape-based capture (fallback when the path hook is inlined
        /// away). Identifies the payload by its top-level keys.</summary>
        public static void CaptureByShape(string json)
        {
            if (_dir == null || string.IsNullOrEmpty(json) || json[0] != '{') return;
            ThreadPool.QueueUserWorkItem(_ =>
            {
                lock (Gate)
                {
                    if (Hooks.PathHookFired) return;
                    try
                    {
                        var keys = TopLevelKeys(json, 16);
                        var name = NameByShape(keys);
                        if (name == null) return;
                        // DecryptMsg runs twice per response (CheckResponse + the
                        // callback) — skip an identical repeat.
                        int h = json.Length ^ json.GetHashCode();
                        int prev;
                        if (LastHash.TryGetValue(name, out prev) && prev == h) return;
                        LastHash[name] = h;
                        WriteKnown(name, json, "(shape)");
                    }
                    catch (Exception e)
                    {
                        Plugin.Log.LogError($"shape write: {e.Message}");
                    }
                }
            });
        }

        // ---- helpers (all called under Gate) --------------------------------

        private static void WriteKnown(string name, string json, string path)
        {
            var file = Path.Combine(_dir, name + ".json");
            AtomicWrite(file, json);
            if (name == "user_item") File.WriteAllText(Path.Combine(_dir, ".captured"), DateTime.UtcNow.ToString("o"));
            _captures++;
            _lastPath = path;
            _lastAt = DateTime.UtcNow.ToString("o");
            WriteHeartbeat();
            Plugin.Log.LogInfo($"{path} → {name}.json ({json.Length:N0} chars)");
        }

        private static void WriteUnknown(string path, string json)
        {
            var dir = Path.Combine(_dir, "_unknown");
            Directory.CreateDirectory(dir);
            var safe = path.TrimStart('/').Replace('/', '_').Replace('.', '_');
            if (safe.Length == 0) safe = "root";
            AtomicWrite(Path.Combine(dir, safe + ".json"), json);
        }

        private static void NoteSeen(string path)
        {
            if (!SeenPaths.Add(path)) return;
            try { File.AppendAllText(Path.Combine(_dir, "seen-paths.log"), path + "\n"); } catch { /* cosmetic */ }
        }

        /// <summary>Write to a temp file then swap it in, so a reader (the
        /// desktop app polls these files) never sees a half-written JSON.</summary>
        private static void AtomicWrite(string file, string content)
        {
            var tmp = file + ".tmp";
            File.WriteAllText(tmp, content, new UTF8Encoding(false));
            if (File.Exists(file)) File.Replace(tmp, file, null);
            else File.Move(tmp, file);
        }

        private static void WriteHeartbeat()
        {
            try
            {
                var sb = new StringBuilder(256);
                sb.Append("{\"version\":\"").Append(Plugin.Version)
                  .Append("\",\"pid\":").Append(Process.GetCurrentProcess().Id)
                  .Append(",\"startedAt\":\"").Append(StartedAt)
                  .Append("\",\"pathHook\":").Append(Hooks.PathHookFired ? "true" : "false")
                  .Append(",\"captures\":").Append(_captures)
                  .Append(",\"lastPath\":").Append(_lastPath == null ? "null" : JsonConvert.ToString(_lastPath))
                  .Append(",\"lastCaptureAt\":").Append(_lastAt == null ? "null" : "\"" + _lastAt + "\"")
                  .Append(",\"outDir\":").Append(JsonConvert.ToString(_dir))
                  .Append('}');
                AtomicWrite(Path.Combine(_dir, ".steam-plugin.json"), sb.ToString());
            }
            catch (Exception e)
            {
                Plugin.Log.LogWarning($"heartbeat: {e.Message}");
            }
        }

        private static bool LooksEncrypted(string s)
        {
            // {"msg":"<hex>"} — what CWebManager receives before DecryptMsg.
            return s.Length > 8 && s.StartsWith("{\"msg\":", StringComparison.Ordinal);
        }

        /// <summary>Depth-1 property names of a JSON object, streamed (no DOM).</summary>
        private static HashSet<string> TopLevelKeys(string json, int max)
        {
            var keys = new HashSet<string>(StringComparer.Ordinal);
            using (var r = new JsonTextReader(new StringReader(json)))
            {
                r.DateParseHandling = DateParseHandling.None;
                while (r.Read())
                {
                    if (r.TokenType == JsonToken.PropertyName && r.Depth == 1)
                    {
                        keys.Add((string)r.Value);
                        if (keys.Count >= max) break;
                        r.Skip();   // jump over the value — we only want the key ring
                    }
                }
            }
            return keys;
        }

        private static string NameByShape(HashSet<string> k)
        {
            if (k.Contains("PresetList") && k.Contains("ItemList")) return "user_item";
            if (k.Contains("SlotList") && k.Contains("CharList")) return "user_character";
            if (k.Contains("SupporterList") && k.Contains("ResetInfo")) return "user_info";
            if (k.Contains("ArchiveItemRewardInfo")) return "user_archive";
            if (k.Contains("GiftList")) return "user_gift";
            if (k.Contains("LobbyList")) return "user_lobby";
            if (k.Contains("PersonalBuffInfo")) return "user_etc";
            if (k.Contains("ItemCustomData")) return "item_customInfo";
            if (k.Count == 1 && k.Contains("AssetList")) return "user_asset";
            return null;
        }
    }
}
