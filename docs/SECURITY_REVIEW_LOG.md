# GNDK Token — Security Review Log

> Pre-audit internal review history.
> This document tracks all security issues identified and fixed before formal audit submission.

---

## Review History

### Review #1: External Code Review (2026-03-16)

**Reviewer**: Development Advisor (c2e-protocol)
**Scope**: gndk-registry, l2e-module, burn-recycle, vesting-program
**Method**: Local + devnet testing, manual code review

#### Findings

| ID | Severity | File | Issue | Status |
|----|----------|------|-------|--------|
| C-1 | **Critical** | `transfer_from_pool.rs:144`, `transfer_from_d2e_pool.rs:143` | **caller 권한 검증 없음** — `caller: Signer`이기만 하면 누구든 Registry를 직접 호출하여 L2E Module 검증을 우회, 풀 자금 탈취 가능 | **Fixed** |
| C-2 | **Critical** | `transfer_from_pool.rs:140-141`, `transfer_from_d2e_pool.rs:139-140` | **user_ata 소유자 검증 없음** — C-1과 결합 시 공격자가 자기 ATA로 토큰 redirect, 풀 전체 drain 가능 | **Fixed** |
| C-3 | **Critical** | `burn-recycle/lib.rs:208-233` | **BurnRecycle mint/ATA 검증 없음** — mint, payer_ata, reward_pool_ata에 다른 토큰을 넣어도 통과 | **Fixed** |
| C-4 | **Low** | `initialize.rs:29-46` | **Initialize에서 Mint Authority 상태 미검증** — TGE 스크립트 순서 보장으로 대응 (방안 B) | **Accepted** |

### Review #2: Internal Security Audit (2026-03-16)

**Reviewer**: Internal (automated + manual)
**Scope**: All 4 programs — focus on account constraint gaps not covered by Review #1

#### Findings

| ID | Severity | File | Issue | Status |
|----|----------|------|-------|--------|
| C-5 | **High** | `vesting-program/lib.rs:456-457` | **Vesting beneficiary_ata 소유자 검증 없음** — C-2와 동일 패턴, 공격자가 자기 ATA로 claim redirect 가능 | **Fixed** |
| C-6 | **Medium** | `vesting-program/lib.rs` (3곳) | **Vesting vault_ata/admin_ata mint 검증 없음** — CreateVesting, Claim, Revoke에서 잘못된 mint의 ATA를 넣을 수 있음 | **Fixed** |
| C-7 | **Medium** | `transfer_from_pool.rs:128-129`, `transfer_from_d2e_pool.rs:127-128` | **Registry pool ATA authority 검증 없음** — defense-in-depth: pool_ata가 실제 pool_authority 소유인지 검증 추가 | **Fixed** |
| C-9 | **High** | `burn-recycle/lib.rs:30-45` | **BurnRecycle initialize에서 mint를 Pubkey 파라미터로 받음** — 임의 Pubkey를 넣을 수 있어 잘못된 mint 등록 가능. Account 타입으로 변경 | **Fixed** |

---

## Fix Summary

### Commit: `698efd3` (2026-03-16)

**Files modified:**
- `programs/gndk-registry/src/instructions/transfer_from_pool.rs`
- `programs/gndk-registry/src/instructions/transfer_from_d2e_pool.rs`
- `programs/burn-recycle/src/lib.rs`
- `programs/vesting-program/src/lib.rs`
- `tests/phase2-4.ts`

**Fix patterns applied:**

1. **Handler-level authorization** (C-1):
```rust
let caller_key = ctx.accounts.caller.key();
require!(
    caller_key == config.admin || caller_key == config.oracle,
    GndkError::Unauthorized
);
```

2. **Token account owner + mint validation** (C-2, C-5):
```rust
#[account(
    mut,
    token::mint = mint,
    token::authority = user_account.owner,  // or beneficiary
)]
pub user_ata: InterfaceAccount<'info, TokenAccount>,
```

3. **Config mint constraint** (C-3):
```rust
#[account(mut, constraint = mint.key() == config.mint @ BurnRecycleError::MintMismatch)]
pub mint: InterfaceAccount<'info, Mint>,
```

4. **Pool ATA authority validation** (C-7):
```rust
#[account(
    mut,
    token::mint = mint,
    token::authority = pool_authority,
)]
pub reward_pool_ata: InterfaceAccount<'info, TokenAccount>,
```

5. **Mint as Account type** (C-9):
```rust
// Before: pub fn initialize(ctx, mint: Pubkey)
// After:
pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
    config.mint = ctx.accounts.mint.key();
}
// + pub mint: InterfaceAccount<'info, Mint> in accounts struct
```

**Test result**: 40/40 passing after all fixes.

---

## Remaining Items for Formal Audit

1. Vesting calculation precision (integer division rounding)
2. CPI trust boundary verification (L2E → Registry)
3. Dynamic Halving phase transition edge cases
4. Annual reset timing (UTC calendar boundary)
5. Maximum extractable value analysis under all constraints
6. Program upgrade authority policy recommendation
