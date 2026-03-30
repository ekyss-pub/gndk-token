# CertiK Audit Fix Report — 2026-03-31 (Round 3)

## Overview

CertiK 3차 보안감사 리포트(GSA-12 ~ GSA-16)에 대한 대응 완료.
코드 수정 2건(GSA-13, GSA-15, GSA-16), Acknowledged 3건(GSA-12, GSA-14).
전수 검사 실시: 동일 패턴의 추가 이슈 없음 확인.
로컬넷 테스트 40/40 전체 통과 확인.

---

## Round 3 Findings

### GSA-12 — Global Pause Scope Inconsistency (Discussion)
**Status: Acknowledged**

The omission of global_pause check in register_module is intentional by design. register_module is an admin-only provisioning instruction, not an operational one. The global_pause mechanism is designed to halt operational actions such as user registration and token transfers, while administrative setup tasks like module registration should remain available even during a pause. This allows the admin to prepare new modules during a paused state so the system is ready when unpaused. This is consistent with the pause/unpause handlers in admin.rs, which also do not enforce the global_pause check.

### GSA-13 — Paused Module Can Bypass Emergency Stop by Supplying Another Active ModuleAccount (Minor)
**Status: Resolved**

Added a constraint in the L2E Distribute instruction to verify that the supplied ModuleAccount's program_id matches the L2E program's own ID. This prevents a paused module from bypassing the emergency stop by substituting another active module's ModuleAccount. A ModuleMismatch error is returned if the binding check fails.

**Modified Files**:
- `programs/l2e-module/src/lib.rs`
  - `Distribute` struct: added `constraint = module_account.program_id == crate::ID @ L2EError::ModuleMismatch`
  - `L2EError`: added `ModuleMismatch` variant

### GSA-14 — Per-User D2E Annual Claims Are Incorrectly Enforced Against Per-Module Limits (Minor)
**Status: Acknowledged**

The current system is designed with a single D2E module architecture. Under this design, UserAccount.d2e_annual_claimed effectively serves as the per-user annual cap for the one active D2E module, and ModuleAccount.annual_limit acts as the per-user ceiling within that module context. Since only one D2E module is registered and operational, there is no cross-module interference in practice. If the system evolves to support multiple concurrent D2E modules in the future, we will introduce per-user-per-module claim tracking with a dedicated PDA to ensure proper isolation between modules.

### GSA-15 — L2E Reward Distribution Does Not Enforce Module Annual Limit (Minor)
**Status: Resolved**

Added enforcement of ModuleAccount.annual_limit in the L2E reward distribution path. When annual_limit is configured (greater than 0), the effective per-user annual cap is now the minimum of the phase-based cap and the module annual_limit. This ensures the module yearly budget is respected alongside the Dynamic Halving phase cap, consistent with the D2E flow.

**Modified Files**:
- `programs/gndk-registry/src/instructions/transfer_from_pool.rs`
  - Added `effective_cap = min(phase_cap, module.annual_limit)` logic in handler

### GSA-16 — Revocation Reapplies Vesting Schedule, Locking Already Vested Tokens and Causing Claim Underflow (Minor)
**Status: Resolved**

Updated calc_vested_amount to return total_amount immediately when the schedule is revoked, bypassing the linear recalculation. Since revoke already snapshots total_amount to the vested amount at revocation time, recalculating over the original timeline would produce incorrect lower values. The revoked schedule is now treated as a finalized snapshot, ensuring all vested-but-unclaimed tokens remain fully claimable without underflow.

**Modified Files**:
- `programs/vesting-program/src/lib.rs`
  - `calc_vested_amount`: added early return for `vesting.revoked == true`

---

## Cross-Pattern Audit (Full Codebase Review)

GSA-12~16에서 도출된 패턴을 기반으로 전체 4개 프로그램에 대해 전수 검사를 실시함.

### 1. Pause Consistency (GSA-12 Pattern)
| Instruction | global_pause / is_active | Result |
|---|---|---|
| register_user | Checked | OK |
| transfer_from_pool | Checked | OK |
| transfer_from_d2e_pool | Checked | OK |
| register_module | Not checked (admin provisioning) | OK (By Design) |
| admin pause/unpause | Not checked (must remain accessible) | OK (By Design) |
| BurnRecycle process_payment | Checked (is_active) | OK |
| BurnRecycle admin_burn | Checked (is_active) | OK |
| Vesting claim | No pause mechanism (beneficiary right) | OK (By Design) |
| Vesting create/revoke | No pause (admin operations) | OK (By Design) |

### 2. Module Binding (GSA-13 Pattern)
| Module | Binding Check | Result |
|---|---|---|
| L2E Distribute | module_account.program_id == crate::ID | OK (GSA-13 Fix) |
| Registry transfer_from_pool | PDA seeds [module, program_id] | OK |
| Registry transfer_from_d2e_pool | PDA seeds [module, program_id] | OK |

### 3. Annual Limit Enforcement (GSA-14/15 Pattern)
| Path | Phase Cap | Module annual_limit | Result |
|---|---|---|---|
| L2E (transfer_from_pool) | Enforced | Enforced via min() | OK (GSA-15 Fix) |
| D2E (transfer_from_d2e_pool) | N/A | Enforced against d2e_annual_claimed | OK |

### 4. Vesting Revoke/Claim Consistency (GSA-16 Pattern)
| Scenario | Behavior | Result |
|---|---|---|
| Revoked + claim | Returns snapshotted total_amount | OK (GSA-16 Fix) |
| Not revoked + claim | Normal linear calculation | OK |

### 5. Authority / Mint / ATA Validation
| Program | Authority Check | Mint Constraint | ATA Validation | Result |
|---|---|---|---|---|
| gndk-registry | All handlers checked | config.mint binding | token::mint + token::authority | OK |
| l2e-module | oracle/admin + crate::ID | l2e_config.mint binding | Delegated to Registry CPI | OK |
| burn-recycle | admin check + payer signer | config.mint binding | token::mint + token::authority | OK |
| vesting-program | admin/beneficiary check | config.mint binding | token::mint + token::authority | OK |

### 6. Arithmetic Safety
All arithmetic operations across 4 programs use checked_add/checked_sub/checked_mul with proper error propagation. No unchecked arithmetic found.

**Conclusion: No additional issues found beyond GSA-12~16.**

---

## Summary

| Finding | Severity | Status | Action |
|---|---|---|---|
| GSA-12 | Discussion | Acknowledged | By design (admin provisioning) |
| GSA-13 | Minor | Resolved | Added module_account.program_id binding |
| GSA-14 | Minor | Acknowledged | Single D2E module architecture |
| GSA-15 | Minor | Resolved | Added annual_limit enforcement in L2E path |
| GSA-16 | Minor | Resolved | Fixed calc_vested_amount for revoked schedules |

**Resolved**: 3 / **Acknowledged**: 2 / **Total**: 5

---

## Test Results

```
40 passing (35s)
0 failing
```

All 40 tests pass on localnet after applying GSA-13, GSA-15, GSA-16 fixes.

Programs built and deployed successfully:
- gndk-registry: 6SZBJmypA1eC6R8C8iPXSRZevwT5bFPuAEcBbSrk1srw
- l2e-module: Ed1GRcVHtXq1fJxwN8SC7rWjmwC4S6kVRGoXKkmv6AkS
- burn-recycle: EV5A8bfAyqYqgscwd2PRoHfTqPg9w7Uxuwgmo4TTYzXp
- vesting-program: 6w23izAP5v6WzqA9eAgb96WvWtckKbquhKbPfXmgMwok
