# GNDK Token — Solana Smart Contracts

> On-chain tokenomics for **eKYSS Learn-to-Earn** ecosystem on Solana.

GNDK is a fixed-supply (1B) SPL Token with Dynamic Halving, dual reward pools, BurnRecycle deflation, and time-locked vesting — designed for sustainable Learn-to-Earn economics.

## Architecture

```
                   ┌─────────────────┐
                   │  gndk-registry   │  Core: pools, users, modules,
                   │  (Program #1)    │  Dynamic Halving, L2E/D2E limits
                   └────────┬────────┘
                            │ CPI
              ┌─────────────┼─────────────┐
              │             │             │
    ┌─────────▼──┐  ┌──────▼──────┐  ┌──▼──────────────┐
    │ l2e-module  │  │ burn-recycle │  │ vesting-program  │
    │ (Program #2)│  │ (Program #3) │  │ (Program #4)     │
    └─────────────┘  └─────────────┘  └──────────────────┘
    Learn-to-Earn     50% Burn +        Cliff + Linear
    CPI rewards       50% Recycle       Unlock + Revoke
```

### Programs

| Program | Description |
|---------|-------------|
| **gndk-registry** | Core registry — reward pools, user/module registration, Dynamic Halving (Phase 1-4), dual pool management (L2E + D2E) |
| **l2e-module** | Learn-to-Earn rewards — oracle-authorized distribution via CPI to Registry |
| **burn-recycle** | Service payments: 50% permanent burn + 50% pool recycle. Admin buyback burn (100%) |
| **vesting-program** | Time-locked token release — cliff period + linear unlock + admin revoke |

## Key Features

### Dynamic Halving

Per-user annual L2E cap decreases as the user base grows:

| Phase | Registered Users | Annual Cap |
|-------|-----------------|------------|
| 1 | 0 - 100K | 70 GNDK |
| 2 | 100K - 1M | 40 GNDK |
| 3 | 1M - 10M | 15 GNDK |
| 4 | 10M+ | 3 GNDK |

Phase transitions happen automatically on-chain when a new user registers.

### Dual Pool Architecture

- **L2E RewardPool** (300M GNDK) — Learn-to-Earn rewards, subject to Phase cap
- **D2E BountyPool** — Data-to-Earn rewards, filled from B2B revenue, independent limits

### BurnRecycle

- `process_payment`: User pays GNDK for services → 50% permanently burned, 50% recycled to RewardPool
- `admin_burn`: Buyback & Burn — 100% permanent burn (for D2E revenue buyback)

### Vesting

| Category | Cliff | Linear Unlock |
|----------|-------|---------------|
| Early Contributors (10%) | 1 year | 1 year |
| Private Sale (10%) | 1 year | 1 year |
| Team/Advisors (5%) | 1 year | 2 years |

## Token Distribution

| Allocation | Amount | % |
|-----------|--------|---|
| Ecosystem Rewards (L2E + Creator) | 300M | 30% |
| Foundation | 250M | 25% |
| Early Contributors | 100M | 10% |
| Private Sale | 100M | 10% |
| Marketing | 100M | 10% |
| Team/Advisors | 50M | 5% |
| Partnership | 50M | 5% |
| Donation | 50M | 5% |
| **Total** | **1,000M** | **100%** |

## Getting Started

### Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) (1.89+)
- [Solana CLI](https://docs.solanalabs.com/cli/install) (3.1+)
- [Anchor](https://www.anchor-lang.com/docs/installation) (0.32.1)
- Node.js (18+)

### Build

```bash
anchor build
```

### Test

```bash
anchor test
```

Runs 40 tests across 2 test suites:
- `tests/gndk-registry.ts` — Phase 1 Registry Core (22 tests)
- `tests/phase2-4.ts` — L2E Module, BurnRecycle, Vesting (18 tests)

### Simulation

```bash
npx ts-node --project simulation/tsconfig.json simulation/gndk-lifecycle.ts
```

Runs 10 scenarios over 5 years (monthly), validating pool sustainability under various conditions.

## Program IDs (Devnet/Localnet)

| Program | ID |
|---------|---|
| gndk-registry | `6SZBJmypA1eC6R8C8iPXSRZevwT5bFPuAEcBbSrk1srw` |
| l2e-module | `Ed1GRcVHtXq1fJxwN8SC7rWjmwC4S6kVRGoXKkmv6AkS` |
| burn-recycle | `EV5A8bfAyqYqgscwd2PRoHfTqPg9w7Uxuwgmo4TTYzXp` |
| vesting-program | `6w23izAP5v6WzqA9eAgb96WvWtckKbquhKbPfXmgMwok` |

## Documentation

- [Tokenomics Specification](docs/TOKENOMICS_SPEC.md) — v2.5.4-sol full spec
- [Simulation Report](docs/SIMULATION_REPORT.md) — 10-scenario 5-year analysis
- [WhitePaper (PDF)](docs/GNDK(WhitePaper)_ENG_v2.5_260304.pdf) — English whitepaper
- [Development State](DEV_STATE.md) — Session handoff & progress tracking

## Project Structure

```
gndk-token/
├── programs/
│   ├── gndk-registry/     # Core registry (Phase 1)
│   ├── l2e-module/        # L2E rewards via CPI (Phase 2)
│   ├── burn-recycle/      # Burn + recycle (Phase 3)
│   └── vesting-program/   # Cliff + linear vesting (Phase 4)
├── tests/
│   ├── gndk-registry.ts   # 22 tests
│   └── phase2-4.ts        # 18 tests
├── simulation/
│   └── gndk-lifecycle.ts  # 5-year tokenomics simulation
├── docs/
│   ├── TOKENOMICS_SPEC.md
│   ├── SIMULATION_REPORT.md
│   └── GNDK(WhitePaper)_ENG_v2.5_260304.pdf
├── Anchor.toml
└── DEV_STATE.md
```

## Security

- All pool transfers require registered & active module verification
- Oracle-based user registration (KYC gating)
- Per-user annual limits enforced on-chain (L2E and D2E independently)
- Module-level daily limits prevent bot abuse
- Global and per-module pause/unpause for emergency response
- Vesting revoke returns only unvested tokens; vested amounts are protected
- BurnRecycle ratio (50/50) is hardcoded — not admin-configurable

## License

ISC

## Links

- Website: [gndtoken.com](https://gndtoken.com)
- eKYSS Platform: [ekyss.com](https://ekyss.com)
