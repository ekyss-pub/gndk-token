# GNDK Token — Security Audit Scope

> Prepared for: Certik
> Repository: https://github.com/ekyss-pub/gndk-token
> Branch: main
> Date: 2026-03-17
> Prepared by: eKYSS Co., Ltd.

---

## 1. Project Overview

GNDK (GANADA TOKEN) is a Learn-to-Earn (L2E) + Data-to-Earn (D2E) utility token for language learning platforms (MYPOOL / GANADARA) operated by eKYSS Co., Ltd.

- **Blockchain**: Solana (Mainnet-Beta target)
- **Token Standard**: SPL Token (not Token-2022)
- **Total Supply**: 1,000,000,000 GNDK (fixed, Mint Authority permanently renounced after TGE)
- **Decimals**: 9
- **Framework**: Anchor 0.32.1

## 2. Programs in Scope

| # | Program | Program ID | Source Path | Lines | Purpose |
|---|---------|-----------|-------------|-------|---------|
| 1 | **gndk-registry** | `6SZBJmyp...` | `programs/gndk-registry/src/` | ~700 | Core: pool management, user registration, Dynamic Halving, module registry |
| 2 | **l2e-module** | `Ed1GRcVH...` | `programs/l2e-module/src/lib.rs` | ~227 | L2E reward distribution via CPI to Registry |
| 3 | **burn-recycle** | `EV5A8bfA...` | `programs/burn-recycle/src/lib.rs` | ~286 | Service payment: 50% permanent burn + 50% pool recycle |
| 4 | **vesting-program** | `6w23izAP...` | `programs/vesting-program/src/lib.rs` | ~527 | Cliff + linear vesting with admin revoke |

**Total Solidity-equivalent LOC**: ~1,740 lines of Rust/Anchor

## 3. Source File Index

### gndk-registry (Core)

```
programs/gndk-registry/src/
├── lib.rs                              # Program entry point (14 instructions)
├── constants.rs                        # Phase caps, thresholds, decimals
├── errors.rs                           # Error codes (12 variants)
├── state.rs                            # PDA account structures (6 types)
└── instructions/
    ├── mod.rs                          # Module exports
    ├── initialize.rs                   # Config, RewardPool, D2E Pool, BurnStats init
    ├── register_user.rs                # Oracle-based KYC user registration + Dynamic Halving
    ├── register_module.rs              # Admin registers external modules
    ├── transfer_from_pool.rs           # L2E distribution (Phase cap enforced)
    ├── transfer_from_d2e_pool.rs       # D2E distribution (independent limits)
    └── admin.rs                        # Pause/unpause/deactivate/oracle update
```

### l2e-module

```
programs/l2e-module/src/
└── lib.rs                              # 5 instructions: initialize, distribute (CPI), pause, unpause, update_oracle
```

### burn-recycle

```
programs/burn-recycle/src/
└── lib.rs                              # 5 instructions: initialize, process_payment, admin_burn, pause, unpause
```

### vesting-program

```
programs/vesting-program/src/
└── lib.rs                              # 5 instructions: initialize, initialize_vault, create_vesting, claim, revoke
```

## 4. Architecture

```
┌─────────────────────────────────────────────────────┐
│                    GNDK SPL Token                    │
│            (1B fixed, Mint Authority = None)         │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│              gndk-registry (Core)                    │
│  ┌─────────────────┐  ┌──────────────────┐          │
│  │ L2E RewardPool  │  │ D2E BountyPool   │          │
│  │ (300M GNDK)     │  │ (initially empty) │          │
│  └────────┬────────┘  └────────┬─────────┘          │
│           │                    │                     │
│  ConfigAccount (PDA)  UserAccount (PDA per user)     │
│  ModuleAccount (PDA per module)                      │
└──────┬──────────────────┬────────────────────────────┘
       │ CPI              │ CPI
┌──────▼──────┐    ┌──────▼──────┐    ┌───────────────┐
│ l2e-module  │    │ burn-recycle│    │vesting-program│
│ (L2E dist.) │    │ (50/50 burn)│    │(cliff+linear) │
└─────────────┘    └─────────────┘    └───────────────┘
```

### Key Design Patterns

1. **Registry + Module**: Core program manages pools; external modules access via CPI only
2. **Dynamic Halving**: Automatic phase transitions at user count thresholds (100K → 1M → 10M)
3. **Dual Pool**: L2E and D2E pools are independent with separate limits
4. **Fixed Supply**: 1B tokens minted at TGE, Mint Authority permanently renounced

## 5. Account (PDA) Summary

| Account | Seeds | Owner Program | Purpose |
|---------|-------|---------------|---------|
| ConfigAccount | `["config"]` | gndk-registry | Global config: admin, oracle, phase, pause state |
| UserAccount | `["user", user_pubkey]` | gndk-registry | Per-user: l2e/d2e claimed, annual reset |
| ModuleAccount | `["module", program_id]` | gndk-registry | Per-module: limits, active state, pool type |
| RewardPoolAuthority | `["reward_pool", mint]` | gndk-registry | L2E pool token authority |
| D2EPoolAuthority | `["d2e_pool", mint]` | gndk-registry | D2E pool token authority |
| BurnStats | `["burn_stats"]` | gndk-registry | Burn/recycle statistics |
| L2EConfig | `["l2e_config"]` | l2e-module | L2E module config |
| BurnRecycleConfig | `["burn_recycle_config"]` | burn-recycle | Burn module config |
| VestingConfig | `["vesting_config"]` | vesting-program | Vesting global config |
| VestingAccount | `["vesting", beneficiary]` | vesting-program | Per-beneficiary schedule |
| VaultAuthority | `["vesting_vault", mint]` | vesting-program | Vault token authority |

## 6. Instruction Summary (29 Total)

### gndk-registry (14 instructions)

| Instruction | Access Control | Description |
|------------|---------------|-------------|
| `initialize` | Admin (once) | Create ConfigAccount |
| `initialize_reward_pool` | Admin (once) | Create L2E pool PDA + ATA |
| `initialize_d2e_pool` | Admin (once) | Create D2E pool PDA + ATA |
| `initialize_burn_stats` | Admin (once) | Create burn stats PDA |
| `register_user` | Oracle or Admin | Register KYC user, auto-phase transition |
| `register_module` | Admin | Register external module program |
| `transfer_from_pool` | Admin or Oracle | L2E: pool → user (Phase cap enforced) |
| `transfer_from_d2e_pool` | Admin or Oracle | D2E: pool → user (module limit) |
| `pause` | Admin | Global pause |
| `unpause` | Admin | Global unpause |
| `pause_module` | Admin | Module-specific pause |
| `unpause_module` | Admin | Module-specific unpause |
| `deactivate_module` | Admin | Permanently disable module |
| `update_oracle` | Admin | Change oracle address |

### l2e-module (5 instructions)

| Instruction | Access Control | Description |
|------------|---------------|-------------|
| `initialize` | Admin (once) | Create L2E config |
| `distribute` | Oracle or Admin | CPI → Registry.transfer_from_pool |
| `pause` | Admin | Pause L2E module |
| `unpause` | Admin | Unpause L2E module |
| `update_oracle` | Admin | Change L2E oracle |

### burn-recycle (5 instructions)

| Instruction | Access Control | Description |
|------------|---------------|-------------|
| `initialize` | Admin (once) | Create burn config |
| `process_payment` | Any user (payer signs) | 50% burn + 50% recycle |
| `admin_burn` | Admin | 100% buyback burn |
| `pause` | Admin | Pause burn module |
| `unpause` | Admin | Unpause burn module |

### vesting-program (5 instructions)

| Instruction | Access Control | Description |
|------------|---------------|-------------|
| `initialize` | Admin (once) | Create vesting config |
| `initialize_vault` | Admin (once) | Create vault ATA |
| `create_vesting` | Admin | Create schedule + deposit tokens |
| `claim` | Beneficiary | Withdraw vested tokens |
| `revoke` | Admin | Return unvested to admin |

## 7. Token Distribution

| Category | % | Amount | Vesting |
|----------|---|--------|---------|
| Ecosystem Reward (L2E) | 30% | 300,000,000 | Immediate (pool-managed) |
| Foundation | 25% | 250,000,000 | Immediate |
| Early Contributors | 10% | 100,000,000 | 1Y cliff + 1Y linear |
| Private Sale | 10% | 100,000,000 | 1Y cliff + 1Y linear |
| Marketing | 10% | 100,000,000 | Immediate |
| Partnership | 5% | 50,000,000 | Immediate |
| Team/Advisors | 5% | 50,000,000 | 1Y cliff + 2Y linear |
| Donation | 5% | 50,000,000 | Immediate |

## 8. Known Security Considerations

### Previously Identified & Fixed (Pre-audit)

| ID | Severity | Issue | Fix Applied |
|----|----------|-------|-------------|
| C-1 | Critical | `transfer_from_pool/d2e`: No caller authorization check | Added `caller == admin \|\| oracle` require in handler |
| C-2 | Critical | `user_ata`: No owner/mint validation | Added `token::mint` + `token::authority` constraints |
| C-3 | Critical | BurnRecycle: No mint/ATA validation | Added `constraint = mint == config.mint` + `token::mint` |
| C-5 | High | Vesting `beneficiary_ata`: No owner validation | Added `token::authority = beneficiary` constraint |
| C-6 | Medium | Vesting `vault_ata/admin_ata`: No mint validation | Added `token::mint` constraints (3 locations) |
| C-7 | Medium | Registry pool ATAs: No authority validation | Added `token::authority = pool_authority` constraints |
| C-9 | High | BurnRecycle `initialize`: mint as Pubkey param | Changed to Account type (InterfaceAccount<Mint>) |

### Areas for Auditor Focus

1. **CPI trust boundaries**: L2E Module → Registry CPI calls
2. **Dynamic Halving phase transition logic**: Auto-advance at user count thresholds
3. **Vesting calculation precision**: Linear interpolation rounding behavior
4. **Annual reset logic**: UTC calendar year boundary handling
5. **Pool drain scenarios**: Maximum extractable value under all constraints
6. **Re-initialization prevention**: PDA `init` vs re-init attacks

## 9. Test Coverage

- **40 test cases**, 100% passing
- Tests cover: initialization, user registration, L2E/D2E transfers, phase caps, daily limits, BurnRecycle 50/50, admin burn, vesting cliff/linear/revoke, pause/unpause, unauthorized access blocking

```bash
# Run tests
anchor build && anchor test
```

## 10. Build & Development

```bash
# Prerequisites
Rust 1.89+, Solana CLI 3.1.10, Anchor 0.32.1

# Build
anchor build

# Test (localnet, auto-starts validator)
anchor test

# Simulation (5-year tokenomics)
npx ts-node --project simulation/tsconfig.json simulation/gndk-lifecycle.ts
```

## 11. Related Documents

| Document | Path | Description |
|----------|------|-------------|
| Tokenomics Spec | `docs/TOKENOMICS_SPEC.md` | Technical specification v2.5.4-sol |
| White Paper | `docs/GNDK(WhitePaper)_ENG_v2.5_260304.pdf` | Business white paper |
| Simulation Report | `docs/SIMULATION_REPORT.md` | 5-year pool sustainability analysis |
| TGE Script | `scripts/tge-devnet.ts` | Devnet deployment script |

## 12. Contact

- **Company**: eKYSS Co., Ltd.
- **Website**: https://gndtoken.com
- **Repository**: https://github.com/ekyss-pub/gndk-token
