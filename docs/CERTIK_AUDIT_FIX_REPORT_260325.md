# CertiK Audit Fix Report — 2026-03-25

## Overview

CertiK 1차 보안감사 리포트(GSA-01 ~ GSA-10)에 대한 수정 작업 완료.
로컬넷 테스트 40/40 전체 통과 확인.

---

## Findings & Actions

### GSA-10 — Missing amount > 0 validation (Informational)
**Status: Resolved**

- `burn-recycle/src/lib.rs`: `process_payment`, `admin_burn`에 `require!(amount > 0, ZeroAmount)` 추가
- `BurnRecycleError::ZeroAmount` 에러 코드 추가

### GSA-09 — Missing Token Account Authority Validation (Minor)
**Status: Resolved**

- `burn-recycle`: `payer_ata`에 `token::authority = payer`, `admin_ata`에 `token::authority = admin` 추가
- `vesting-program`: `vault_ata`에 `token::authority = vault_authority`, `admin_ata`에 `token::authority = admin` 추가
- `CreateVesting` instruction에 `vault_authority` 계정 추가

### GSA-08 — Front-running Risk (Medium)
**Status: Acknowledged**

- 모든 initialize 함수에 deployer authority 검증 부재
- 메인넷 배포 전 DEPLOYER pubkey 하드코딩 + constraint 추가 예정
- 현재는 TGE 배포 스크립트로 단일 트랜잭션 순차 실행

### GSA-07 — Missing Mint Binding in ModuleAccount and UserAccount Seeds (Medium)
**Status: Resolved**

- `transfer_from_pool`, `transfer_from_d2e_pool`의 mint 계정에 `constraint = mint.key() == config.mint` 추가
- `GndkError::MintMismatch` 에러 코드 추가

### GSA-06 — Missing Validation for MAX_PHASE Allows Registration Beyond Protocol Limits (Medium)
**Status: Acknowledged (By Design)**

- Phase 4(MAX_PHASE) 도달 후에도 유저 등록은 계속되어야 함
- Dynamic Halving은 보상 cap 조절 메커니즘이지 등록 제한이 아님
- Phase 4 유저는 연간 3 GNDK cap으로 계속 보상 수령 가능

### GSA-05 — Missing Constraint on mint Account Permits Arbitrary Token Accounts (Medium)
**Status: Resolved**

- `vesting-program`: InitializeVault, CreateVesting, Claim, Revoke 모든 instruction의 mint에 `constraint = mint.key() == config.mint` 추가
- `VestingError::MintMismatch` 에러 코드 추가
- gndk-registry는 GSA-07에서 이미 수정 완료

### GSA-04 — Revoking a Vesting Schedule Can Permanently Lock Vested but Unclaimed Tokens (Medium)
**Status: Resolved**

- `claim`에서 `require!(!vesting.revoked)` 제거
- revoke 시 `total_amount = vested`로 설정되므로 추가 accrual 없이 남은 claimable만 인출 가능

### GSA-03 — Reward Pool Address is Not Validated Against Configuration (Major)
**Status: Resolved**

- `BurnRecycleConfig`에 `reward_pool_ata: Pubkey` 필드 추가 (SIZE 98 -> 130)
- `initialize`에 `reward_pool_ata` 파라미터 추가
- `ProcessPayment`에 `constraint = reward_pool_ata.key() == config.reward_pool_ata` 추가
- `BurnRecycleError::InvalidRewardPool` 에러 코드 추가

### GSA-02 — Centralization Related Risks and Upgradability (Centralization)
**Status: Acknowledged**

- 메인넷 배포 전 Squads multisig (3/5) 적용 예정
- 중기: timelock 메커니즘 도입 검토
- 장기: DAO 거버넌스 전환 + 프로그램 immutable 전환 계획

### GSA-01 — Payout Authorization Model Is Inconsistent with Module-Only Comments (Discussion)
**Status: Resolved**

- `transfer_from_pool`, `transfer_from_d2e_pool` 주석을 실제 하이브리드 인증 모델에 맞게 수정
- "admin/oracle 권한 + 등록된 활성 모듈 컨텍스트 필수"로 명확화

---

## Modified Files

### Programs
- `programs/burn-recycle/src/lib.rs`
- `programs/gndk-registry/src/errors.rs`
- `programs/gndk-registry/src/instructions/transfer_from_pool.rs`
- `programs/gndk-registry/src/instructions/transfer_from_d2e_pool.rs`
- `programs/vesting-program/src/lib.rs`

### Tests
- `tests/phase2-4.ts`

---

## Test Results

```
40 passing (35s)
0 failing
```

All 40 tests pass on localnet after applying fixes.
