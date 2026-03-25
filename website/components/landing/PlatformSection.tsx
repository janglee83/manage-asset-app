import { Monitor, Apple, Cpu } from "lucide-react";

const platforms = [
  {
    icon: Apple,
    name: "macOS",
    color: "from-zinc-400 to-zinc-600",
    ring: "ring-zinc-500/20",
    versions: [
      { label: "Monterey 12+", arch: "Intel x64 + Apple Silicon" },
      { label: "Ventura 13+", arch: "Universal binary" },
      { label: "Sonoma 14+", arch: "Universal binary" },
    ],
    badge: "Universal",
    badgeColor: "text-zinc-300 bg-zinc-800 ring-zinc-700",
    note: "Native arm64 + x86_64 fat binary",
  },
  {
    icon: Monitor,
    name: "Windows",
    color: "from-sky-500 to-blue-600",
    ring: "ring-sky-500/20",
    versions: [
      { label: "Windows 10 21H2+", arch: "x64" },
      { label: "Windows 11", arch: "x64 / arm64 (beta)" },
    ],
    badge: "MSI Installer",
    badgeColor: "text-sky-300 bg-sky-500/10 ring-sky-500/25",
    note: "Per-user install, no elevation needed",
  },
  {
    icon: Cpu,
    name: "Linux",
    color: "from-orange-500 to-amber-500",
    ring: "ring-orange-500/20",
    versions: [
      { label: "Ubuntu 22.04+", arch: "x86_64" },
      { label: "Ubuntu 24.04+", arch: "x86_64" },
      { label: "Debian 12+", arch: "x86_64" },
      { label: "Other (glibc 2.35+)", arch: "AppImage" },
    ],
    badge: "AppImage + .deb",
    badgeColor: "text-orange-300 bg-orange-500/10 ring-orange-500/25",
    note: "AppImage runs on any x86_64 distro",
  },
];

export function PlatformSection() {
  return (
    <section className="py-24 sm:py-32 border-t border-zinc-800/50">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center mb-16">
          <p className="text-sm font-semibold uppercase tracking-widest text-violet-400 mb-3">
            Platform Support
          </p>
          <h2 className="text-4xl font-bold tracking-tight text-zinc-50">
            Works where you work
          </h2>
          <p className="mt-4 text-lg text-zinc-400">
            Native installers for every major operating system and CPU
            architecture.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-3">
          {platforms.map((platform) => {
            const Icon = platform.icon;
            return (
              <div
                key={platform.name}
                className={`relative rounded-2xl border border-zinc-800 bg-zinc-900/50 p-7 ring-1 ${platform.ring} hover:bg-zinc-900 transition-colors`}
              >
                {/* Platform icon */}
                <div
                  className={`inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${platform.color} mb-5 shadow-lg`}
                >
                  <Icon className="h-5 w-5 text-white" />
                </div>

                <div className="flex items-start justify-between mb-4">
                  <h3 className="text-lg font-semibold text-zinc-100">
                    {platform.name}
                  </h3>
                  <span
                    className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ${platform.badgeColor}`}
                  >
                    {platform.badge}
                  </span>
                </div>

                {/* Version list */}
                <ul className="space-y-2 mb-4">
                  {platform.versions.map((v) => (
                    <li
                      key={v.label}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="text-zinc-300">{v.label}</span>
                      <span className="text-zinc-600 text-xs">{v.arch}</span>
                    </li>
                  ))}
                </ul>

                <p className="text-xs text-zinc-600 border-t border-zinc-800 pt-4">
                  {platform.note}
                </p>
              </div>
            );
          })}
        </div>

        {/* Architecture callout */}
        <div className="mt-10 rounded-2xl border border-zinc-800 bg-zinc-900/30 px-8 py-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-zinc-200">
              Apple Silicon M1 / M2 / M3
            </p>
            <p className="text-xs text-zinc-500 mt-0.5">
              Native arm64 execution — no Rosetta, 3× faster CLIP embedding via
              Metal GPU (MPS)
            </p>
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-200">
              CUDA GPU acceleration
            </p>
            <p className="text-xs text-zinc-500 mt-0.5">
              Detected automatically on Windows / Linux — reduces embedding time
              by up to 6×
            </p>
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-200">CPU fallback</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              OpenBLAS CPU inference on all platforms with no additional setup
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
