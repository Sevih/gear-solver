import { CyanButton } from "../design/Shell.js";

export function BuilderScreen() {
  return (
    <div className="flex h-full min-h-0 flex-col px-6 pb-6 pt-4">
      <div className="flex items-baseline gap-3">
        <h1 className="font-display text-[20px] font-semibold tracking-tight text-zinc-50">Builder</h1>
        <span className="text-[11.5px] text-zinc-500">Pick a hero, set weights and constraints, then SOLVE for the best build.</span>
      </div>

      <div className="mt-6 flex flex-1 items-center justify-center">
        <div
          className="rounded-2xl border border-white/8 bg-bg-elev-2 px-10 py-12 text-center shadow-[0_1px_0_oklch(1_0_0/0.04)_inset,0_24px_60px_-30px_rgb(0_0_0/0.7)]"
        >
          <div
            className="mx-auto grid h-16 w-16 place-items-center rounded-2xl"
            style={{ background: "linear-gradient(135deg, #16EBF1, #9D51FF 60%, #E02BCD)", boxShadow: "0 0 32px rgba(157,81,255,0.45)" }}
          >
            <svg viewBox="0 0 24 24" className="h-7 w-7 text-white" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
              <circle cx={12} cy={12} r={3.5} />
              <path d="M12 2 V5 M12 19 V22 M2 12 H5 M19 12 H22 M5 5 L7 7 M17 17 L19 19 M5 19 L7 17 M17 7 L19 5" />
            </svg>
          </div>
          <h2 className="mt-4 font-display text-[18px] font-semibold text-zinc-100">Solver coming next</h2>
          <p className="mx-auto mt-2 max-w-md text-[12.5px] leading-relaxed text-zinc-500">
            Stat weights, min/max constraints, required sets, locked pieces — the ranking engine ships with M5. For now, browse and verify your data in Inventory & Builds.
          </p>
          <div className="mt-5 flex items-center justify-center gap-2">
            <CyanButton disabled>SOLVE</CyanButton>
          </div>
        </div>
      </div>
    </div>
  );
}
