import { mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createEquipJournalFollower,
  EQUIP_JOURNAL,
  foldEquipEvents,
  parseEquipJournal,
  type EquipEvent,
} from "../src/equip-events.js";

// Uids shaped like the real capture (10-digit strings, far below 2^53).
const HERO_A = "6012124257";
const HERO_B = "4051832267";
const W1 = "6124885095"; // free weapon
const W2 = "6036468941"; // weapon on A
const H1 = "4314195620"; // helmet on B
const H2 = "4314888893"; // free helmet

function snapshot() {
  return {
    ItemList: [
      { ItemUID: W1, CharUID: "0", ItemID: 1 },
      { ItemUID: W2, CharUID: HERO_A, ItemID: 2 },
      { ItemUID: H1, CharUID: HERO_B, ItemID: 3 },
      { ItemUID: H2, CharUID: "0", ItemID: 4 },
    ],
    PresetList: [{ Num: 1 }],
  };
}

const owners = (raw: { ItemList: Array<{ ItemUID: string; CharUID: string }> }) =>
  Object.fromEntries(raw.ItemList.map((it) => [it.ItemUID, it.CharUID]));

// Responses built after CWebRES_ItemEquip / CWebRES_ItemEquipAll (ids as the
// server spells them: JSON strings).
const equip = (seq: number, res: Record<string, string>): EquipEvent =>
  ({ seq, path: "/item/equip", res: { CharUID: "0", UnEquipCharUID: "0", ToEquipUID: "0", ToInvenUID: "0", ...res } });

describe("foldEquipEvents", () => {
  it("plain equip: the piece joins the hero", () => {
    const { next, applied, skipped } = foldEquipEvents(snapshot(), [equip(1, { CharUID: HERO_B, ToEquipUID: W1 })]);
    expect(owners(next)[W1]).toBe(HERO_B);
    expect([applied, skipped]).toEqual([1, 0]);
  });

  it("slot swap: the old piece goes back to the inventory, the new one joins", () => {
    const { next, applied } = foldEquipEvents(snapshot(), [equip(1, { CharUID: HERO_A, ToEquipUID: W1, ToInvenUID: W2 })]);
    expect(owners(next)).toMatchObject({ [W1]: HERO_A, [W2]: "0" });
    expect(applied).toBe(2);
  });

  it("take off: ToEquipUID 0 frees ToInvenUID", () => {
    const { next } = foldEquipEvents(snapshot(), [equip(1, { CharUID: HERO_A, ToInvenUID: W2 })]);
    expect(owners(next)[W2]).toBe("0");
  });

  it("taken from another hero (UnEquipCharUID): the piece changes owner", () => {
    const { next, applied } = foldEquipEvents(snapshot(), [equip(1, { CharUID: HERO_A, UnEquipCharUID: HERO_B, ToEquipUID: H1 })]);
    expect(owners(next)[H1]).toBe(HERO_A);
    expect(applied).toBe(1);
  });

  it("equipAll: UnEquipList, then ToInvenList, then ToEquipList", () => {
    const ev: EquipEvent = {
      seq: 1,
      path: "/item/equipAll",
      res: {
        CharUID: HERO_A,
        ToEquipList: [W1, H1, "0"],
        ToInvenList: [W2, "0", "0"],
        UnEquipList: [{ CharUID: HERO_B, ItemUID: H1 }],
      },
    };
    const { next, applied, skipped } = foldEquipEvents(snapshot(), [ev]);
    expect(owners(next)).toEqual({ [W1]: HERO_A, [W2]: "0", [H1]: HERO_A, [H2]: "0" });
    expect([applied, skipped]).toEqual([3, 0]);
  });

  it("an uid missing from the snapshot is skipped, never invented", () => {
    const { next, applied, skipped } = foldEquipEvents(snapshot(), [equip(1, { CharUID: HERO_A, ToEquipUID: "6199999999", ToInvenUID: W2 })]);
    expect(next.ItemList.map((it) => it.ItemUID)).toEqual([W1, W2, H1, H2]);
    expect(owners(next)[W2]).toBe("0");
    expect([applied, skipped]).toEqual([1, 1]);
  });

  it("numeric ids are accepted while exact, an unsafe one is skipped", () => {
    const ev = (to: number): EquipEvent => ({ seq: 1, path: "/item/equip", res: { CharUID: Number(HERO_A), ToEquipUID: to, ToInvenUID: 0 } });
    expect(owners(foldEquipEvents(snapshot(), [ev(Number(W1))]).next)[W1]).toBe(HERO_A);
    expect(foldEquipEvents(snapshot(), [ev(2 ** 60)]).skipped).toBe(1);
  });

  it("is idempotent: replaying the same events changes nothing", () => {
    const events = [
      equip(1, { CharUID: HERO_A, ToEquipUID: W1, ToInvenUID: W2 }),
      equip(2, { CharUID: HERO_A, UnEquipCharUID: HERO_B, ToEquipUID: H1 }),
    ];
    const once = foldEquipEvents(snapshot(), events);
    const twice = foldEquipEvents(once.next, events);
    expect(twice.next).toEqual(once.next);
    expect(twice.applied).toBe(0);
  });

  it("keeps the other keys and leaves the input untouched", () => {
    const raw = snapshot();
    const { next } = foldEquipEvents(raw, [equip(1, { CharUID: HERO_B, ToEquipUID: W1 })]);
    expect(next.PresetList).toEqual([{ Num: 1 }]);
    expect(owners(raw)[W1]).toBe("0");
  });
});

describe("parseEquipJournal", () => {
  it("reads complete lines only and drops malformed ones", () => {
    const text = [
      JSON.stringify(equip(1, { CharUID: HERO_B, ToEquipUID: W1 })),
      "not json",
      JSON.stringify({ seq: 2, path: "/item/equip", res: {} }),
      '{"seq":3,"path":"/item/eq', // torn: the plugin is mid-append
    ].join("\n");
    expect(parseEquipJournal(text).map((e) => e.seq)).toEqual([1, 2]);
    expect(parseEquipJournal("")).toEqual([]);
  });
});

describe("createEquipJournalFollower", () => {
  function folder() {
    const dir = mkdtempSync(join(tmpdir(), "gs-eq-"));
    const file = join(dir, "user_item.json");
    writeFileSync(file, JSON.stringify(snapshot()));
    // Back-date it, so a rewrite always shows a different mtime.
    utimesSync(file, new Date(2026, 0, 1), new Date(2026, 0, 1));
    const journal = (events: EquipEvent[]) =>
      writeFileSync(join(dir, EQUIP_JOURNAL), events.map((e) => JSON.stringify(e) + "\n").join(""));
    const read = () => owners(JSON.parse(readFileSync(file, "utf-8")) as ReturnType<typeof snapshot>);
    return { dir, file, journal, read };
  }

  it("folds new lines once, then stays idle until the journal grows", () => {
    const f = folder();
    const follower = createEquipJournalFollower(f.dir);
    f.journal([equip(1, { CharUID: HERO_B, ToEquipUID: W1 })]);
    expect(follower.sync()).toBe(1);
    expect(f.read()[W1]).toBe(HERO_B);
    const mtime = statSync(f.file).mtimeMs;
    expect(follower.sync()).toBe(0);
    expect(statSync(f.file).mtimeMs).toBe(mtime);
    f.journal([equip(1, { CharUID: HERO_B, ToEquipUID: W1 }), equip(2, { CharUID: HERO_A, ToInvenUID: W2 })]);
    expect(follower.sync()).toBe(1);
    expect(f.read()).toMatchObject({ [W1]: HERO_B, [W2]: "0" });
  });

  it("remembers what it folded across an app restart", () => {
    const f = folder();
    f.journal([equip(1, { CharUID: HERO_B, ToEquipUID: W1 })]);
    expect(createEquipJournalFollower(f.dir).sync()).toBe(1);
    const mtime = statSync(f.file).mtimeMs;
    expect(createEquipJournalFollower(f.dir).sync()).toBe(0);
    expect(statSync(f.file).mtimeMs).toBe(mtime);
  });

  it("starts from zero after a truncation by a new /user/item", () => {
    const f = folder();
    const follower = createEquipJournalFollower(f.dir);
    f.journal([equip(1, { CharUID: HERO_B, ToEquipUID: W1 }), equip(2, { CharUID: HERO_A, ToInvenUID: W2 })]);
    expect(follower.sync()).toBe(2);
    // New lobby: the plugin empties the journal, then rewrites the snapshot.
    f.journal([]);
    writeFileSync(f.file, JSON.stringify(snapshot()));
    expect(follower.sync()).toBe(0);
    expect(f.read()[W1]).toBe("0");
    // A new move after the lobby lands on the fresh snapshot.
    f.journal([equip(3, { CharUID: HERO_A, ToEquipUID: H2 })]);
    expect(follower.sync()).toBe(1);
    expect(f.read()).toMatchObject({ [H2]: HERO_A, [W1]: "0", [W2]: HERO_A });
  });

  it("replays a new game session whose seq restarted at 1, even unseen while empty", () => {
    const f = folder();
    const follower = createEquipJournalFollower(f.dir);
    f.journal([equip(1, { CharUID: HERO_B, ToEquipUID: W1 }), equip(2, { CharUID: HERO_A, ToInvenUID: W2 })]);
    expect(follower.sync()).toBe(2);
    // Game restarted: login rewrote the snapshot and truncated, then one move.
    writeFileSync(f.file, JSON.stringify(snapshot()));
    f.journal([equip(1, { CharUID: HERO_A, ToEquipUID: H2 })]);
    expect(follower.sync()).toBe(1);
    expect(f.read()).toMatchObject({ [H2]: HERO_A, [W1]: "0", [W2]: HERO_A });
  });

  it("does not replay the journal over the app's own write-back", () => {
    const f = folder();
    const follower = createEquipJournalFollower(f.dir);
    f.journal([equip(1, { CharUID: HERO_B, ToEquipUID: W1 })]);
    expect(follower.sync()).toBe(1);
    // Game closed, local edit: W1 back to the inventory.
    const edited = snapshot();
    writeFileSync(f.file, JSON.stringify(edited));
    follower.noteSnapshotWritten();
    expect(follower.sync()).toBe(0);
    expect(f.read()[W1]).toBe("0");
  });
});
