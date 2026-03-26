# CertiK Audit Fix Report — 2026-03-26 (Round 2)

## Overview

CertiK 2차 보안감사 리포트(GSA-01 ~ GSA-11)에 대한 최종 대응 완료.
Round 1에서 수정된 10건(GSA-01~10) 검증 + 신규 1건(GSA-11) 수정.
로컬넷 테스트 40/40 전체 통과 확인.

---

## Round 2 New Finding

### GSA-11 — Data Pollution in total_distributed via Multi-Token CPI (Informational)
**Status: Resolved**

**Issue**: `l2e-module`의 `distribute` instruction에서 `total_distributed` 카운터가 mint 검증 없이 누적되어, 다른 토큰이 CPI로 전달될 경우 무의미한 합계가 생성될 수 있음.

**Fix Applied**:
- `L2EConfig`에 `mint: Pubkey` 필드 추가 (SIZE 82 → 114)
- `Initialize`에 `mint: InterfaceAccount<Mint>` 계정 추가, 초기화 시 바인딩
- `Distribute`에 `constraint = mint.key() == l2e_config.mint @ L2EError::MintMismatch` 추가
- `L2EError::MintMismatch` 에러 코드 추가

**Modified Files**:
- `programs/l2e-module/src/lib.rs` — State, Initialize, Distribute, Error
- `tests/phase2-4.ts` — Initialize 호출에 mint 계정 전달
- `scripts/tge-devnet.ts` — Initialize 호출에 mint 계정 전달
- `scripts/tge-integration-test.ts` — Initialize 호출에 mint 계정 전달

---

## Round 1 Findings — Final Status

### GSA-10 — Missing amount > 0 validation (Informational)
**Status: Resolved (Verified by CertiK)**

### GSA-09 — Missing Token Account Authority Validation (Minor)
**Status: Resolved (Verified by CertiK)**

### GSA-08 — Front-running Risk (Medium)
**Status: Acknowledged (Maintained)**

We maintain our original position. The DEPLOYER authority check will be implemented as part of the mainnet release preparation, not in the current devnet/testnet branch. The production deployer will be a Squads multisig (3/5) address, which has not yet been finalized (ref: GSA-02 roadmap). Implementation will follow the stated plan: all 8 initialize functions across 4 programs will receive `require!(admin.key() == DEPLOYER)` constraints once the production authority is confirmed.

### GSA-07 — Missing Mint Binding in ModuleAccount and UserAccount Seeds (Medium)
**Status: Resolved (Verified by CertiK)**

CertiK confirmed: "The functions transfer_from_pool and transfer_from_d2e_pool only support config.mint."

### GSA-06 — Missing Validation for MAX_PHASE Allows Registration Beyond Protocol Limits (Medium)
**Status: Acknowledged (By Design)**

### GSA-05 — Missing Constraint on mint Account Permits Arbitrary Token Accounts (Medium)
**Status: Resolved (Verified by CertiK)**

### GSA-04 — Revoking a Vesting Schedule Can Permanently Lock Vested but Unclaimed Tokens (Medium)
**Status: Resolved (Verified by CertiK)**

### GSA-03 — Reward Pool Address is Not Validated Against Configuration (Major)
**Status: Resolved (Verified by CertiK)**

### GSA-02 — Centralization Related Risks and Upgradability (Centralization)
**Status: Acknowledged (Updated)**

Additional commitment: quarterly oracle key rotation, monthly multisig signer health checks, automated on-chain monitoring for unauthorized admin/oracle transactions, and documented incident response procedures. Security operations document to be published before mainnet launch.

### GSA-01 — Payout Authorization Model Is Inconsistent with Module-Only Comments (Discussion)
**Status: Resolved (Verified by CertiK)**

---

## Summary

| Finding | Severity | Round 1 Status | Round 2 Status |
|---------|----------|---------------|----------------|
| GSA-01 | Discussion | Resolved | Verified |
| GSA-02 | Centralization | Acknowledged | Acknowledged (Updated) |
| GSA-03 | Major | Resolved | Verified |
| GSA-04 | Medium | Resolved | Verified |
| GSA-05 | Medium | Resolved | Verified |
| GSA-06 | Medium | Acknowledged | Acknowledged |
| GSA-07 | Medium | Resolved | Verified |
| GSA-08 | Medium | Acknowledged | Acknowledged |
| GSA-09 | Minor | Resolved | Verified |
| GSA-10 | Informational | Resolved | Verified |
| **GSA-11** | **Informational** | **N/A (New)** | **Resolved** |

**Resolved**: 8 / **Acknowledged**: 3 / **Total**: 11

## Test Results

```
40 passing (35s)
0 failing
```

All 40 tests pass on localnet after applying GSA-11 fix.
