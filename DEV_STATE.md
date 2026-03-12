# GNDK Token — 개발 상태 문서

> 세션 간 인수인계용. 새 세션 시작 시 이 문서 먼저 읽을 것.
>
> **마지막 업데이트**: 2026-03-12
> **현재 단계**: Phase 1~4 완료 (4 프로그램 — 40/40 테스트 통과)

---

## 개발 환경

| 항목 | 버전 | 경로 |
|------|------|------|
| Rust (Anchor용) | 1.89.0 | `rust-toolchain.toml` |
| Solana CLI | 3.1.10 (Agave) | `~/dev/solana/install/` |
| Anchor | 0.32.1 | `~/dev/cargo/bin/anchor` |
| Node.js | 18.17.0 | 시스템 |

### PATH 설정

```bash
export RUSTUP_HOME=~/dev/rustup
export CARGO_HOME=~/dev/cargo
export PATH="$CARGO_HOME/bin:$HOME/dev/solana/install/active_release/bin:$PATH"
```

---

## 프로그램 정보

| 프로그램 | Program ID | 역할 |
|----------|-----------|------|
| gndk-registry | `6SZBJmypA1eC6R8C8iPXSRZevwT5bFPuAEcBbSrk1srw` | Core: 풀 관리, Dynamic Halving, 유저/모듈 등록 |
| l2e-module | `Ed1GRcVHtXq1fJxwN8SC7rWjmwC4S6kVRGoXKkmv6AkS` | L2E: 학습 보상 분배 (CPI → Registry) |
| burn-recycle | `EV5A8bfAyqYqgscwd2PRoHfTqPg9w7Uxuwgmo4TTYzXp` | BurnRecycle: 결제 50% 소각 + 50% 리사이클 |
| vesting-program | `6w23izAP5v6WzqA9eAgb96WvWtckKbquhKbPfXmgMwok` | Vesting: cliff + linear unlock + revoke |

---

## 사양 참조

- **사양서**: `~/dev/nskit-v1/nskit-projects/gndk-solana/EKYSS_L2E_TOKENOMICS_SOLANA.md` v2.5.4-sol
- **시뮬레이션 리포트**: `~/dev/nskit-v1/nskit-projects/gndk-solana/GNDK_TOKENOMICS_SIMULATION_REPORT.md`
- **시뮬레이션 실행**: `npx ts-node --project simulation/tsconfig.json simulation/gndk-lifecycle.ts`
- **NSKIT 프로토타입**: `~/dev/solana/nskit-token/` (참조용)

---

## NSKIT → GNDK 주요 차이

| 기능 | NSKIT | GNDK |
|------|-------|------|
| Dynamic Halving | 없음 | Phase 1~4 온체인 자동 전환 |
| 보상 풀 | 1개 (RewardPool) | 2개 (Reward + D2E Bounty) |
| 일일 한도 | 모듈 글로벌 | 유저별 일일 인출 한도 (Stage 1) |
| BurnRecycle | Registry 내장 | 별도 프로그램 (독립 SPL 처리) |
| Vesting | 없음 | 별도 프로그램 (cliff + linear + revoke) |
| 연간 한도 | `module.annual_limit` | Phase cap (L2E), per-module (기타) |
| UserAccount | `annual_earned` (글로벌) | `l2e_annual_claimed` + `d2e_annual_claimed` (분리) |
| 파일 구조 | 단일 `lib.rs` | 멀티파일 (`state.rs`, `instructions/`, `errors.rs`) |
| L2E 모듈 | 없음 (Registry 내장) | 별도 프로그램 (CPI → Registry) |

---

## 진행 상황

### ✅ 완료

| Phase | 내용 | 테스트 |
|-------|------|--------|
| Phase 0 | 프로젝트 세팅: 4 프로그램 구조, keypair, Anchor.toml, 시뮬레이션 복사 | — |
| Phase 1 | **Registry Core**: 멀티파일 구조, ConfigAccount, UserAccount, ModuleAccount, Dynamic Halving (Phase 1~4), 듀얼풀 (L2E+D2E), 일일한도, 연간한도, oracle 기반 유저등록, admin 제어 | 22/22 ✅ |
| Phase 2 | **L2E Module**: CPI → Registry.transfer_from_pool, oracle/admin 인증, Phase cap CPI 적용, pause/unpause | 6/6 ✅ |
| Phase 3 | **BurnRecycle**: process_payment (50% burn + 50% recycle), admin_burn (100% buyback burn), pause/unpause | 4/4 ✅ |
| Phase 4 | **Vesting**: cliff + linear unlock, 시간 기반 claim, admin revoke (미해제분 반환), vault PDA 관리 | 7/7 ✅ |
| 시뮬레이션 | **GNDK 라이프사이클 시뮬레이션** (10 시나리오, 5년 월단위) — 온체인 파라미터 검증 완료 | 10/10 ✅ |

### 프로그램 구조 상세

```
gndk-registry/src/                  # Phase 1 — Core (14 instructions)
├── lib.rs                          # 프로그램 진입점
├── constants.rs                    # Phase caps [70,40,15,3], thresholds
├── errors.rs                       # GndkError enum (12 코드)
├── state.rs                        # Config, User, Module, Pool PDAs
└── instructions/
    ├── mod.rs
    ├── initialize.rs               # initialize, reward_pool, d2e_pool, burn_stats
    ├── register_user.rs            # oracle/admin → Dynamic Halving 자동 전환
    ├── register_module.rs          # admin → pool_type: L2E/D2E
    ├── transfer_from_pool.rs       # L2E Phase cap 적용
    ├── transfer_from_d2e_pool.rs   # D2E 별도 한도
    └── admin.rs                    # pause, unpause, deactivate, update_oracle

l2e-module/src/lib.rs               # Phase 2 — L2E (5 instructions)
  └── initialize, distribute (CPI), update_oracle, pause, unpause
  └── L2EConfig PDA: admin, oracle, is_active, total_distributed

burn-recycle/src/lib.rs             # Phase 3 — BurnRecycle (4 instructions)
  └── initialize, process_payment (50/50), admin_burn (100%), pause, unpause
  └── BurnRecycleConfig PDA: admin, mint, total_burned, total_recycled, total_admin_burned

vesting-program/src/lib.rs          # Phase 4 — Vesting (5 instructions)
  └── initialize, initialize_vault, create_vesting, claim, revoke
  └── VestingConfig PDA, VestingAccount PDA, VaultAuthority PDA
  └── calc_vested_amount(): cliff 이전=0, linear 비례, 완료=전액
```

### 🔜 다음

| Phase | 내용 | 비고 |
|-------|------|------|
| Phase 5 | TGE 시퀀스 스크립트 (21단계) + 통합 테스트 | TGE 전 실행 |
| 향후 | NFT Integration, OFT/Multichain, Oracle 고도화 | TGE 후 append |

---

## 빠른 시작 (새 세션용)

```bash
export RUSTUP_HOME=~/dev/rustup
export CARGO_HOME=~/dev/cargo
export PATH="$CARGO_HOME/bin:$HOME/dev/solana/install/active_release/bin:$PATH"

cd ~/dev/solana/gndk-token
anchor build
anchor test  # localnet 자동 시작 + 40 테스트

# 시뮬레이션 실행
npx ts-node --project simulation/tsconfig.json simulation/gndk-lifecycle.ts
```

---

## 테스트 구조

```
tests/
├── gndk-registry.ts    # Phase 1: A1~G1 (22 tests)
└── phase2-4.ts         # Phase 2~4: H1~K1 (18 tests)
```

Phase 2-4 테스트는 Phase 1 테스트가 생성한 Registry 상태를 재사용:
- `configPda` 를 fetch하여 mint 주소 획득
- `getTokenAccountsByOwner`로 RewardPool ATA 자동 탐지
- Vesting은 별도 mint 사용 (풀 충돌 방지)

---

## Anchor SDK 주의사항

- `l2e_xxx` → JS에서 `l2EXxx` (대문자 E), `d2e_xxx` → `D2EXxx` (대문자 D2E)
- 메서드: `initializeD2EPool`, `transferFromD2EPool` (D2E 전부 대문자)
- 필드: `l2EAnnualClaimed`, `d2EAnnualClaimed`, `totalD2EDistributed`
- L2E Config: `l2e.account.l2EConfig.fetch()` (대문자 E 주의)
- 테스트에서 `(registry.methods as any).initializeD2EPool()` 형태로 호출

---

## 시뮬레이션 결과 요약 (10 시나리오)

모든 시나리오에서 5년간 풀 안전. 핵심:
- **풀스펙(He/She + Live + Creator) 12개월 내 출시**가 자가 지속의 핵심 (시나리오 C: 97% 커버률)
- **포인트 임계값 1,000~1,500pt / 소멸 3~6개월**이 최적 밸런스 (시나리오 I: 126% 커버률)
- Dynamic Halving + Phase cap이 모든 시나리오에서 풀 보호 효과 검증

---

*마지막 업데이트: 2026-03-12 — Phase 1~4 완료 (4 프로그램, 40/40 테스트 통과)*
