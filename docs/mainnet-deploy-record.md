# GNDK Mainnet Deployment Record

> Date: 2026-04-04
> Network: Solana Mainnet-Beta
> Deployer: 3u9QfuTTC5nDe9359T9eh3j6MirBiRqFwv5wLiNx2JSD

---

## Wallet Addresses

| Role | Address |
|------|---------|
| Deployer | `3u9QfuTTC5nDe9359T9eh3j6MirBiRqFwv5wLiNx2JSD` |
| CEO (Signer 1) | `4T7g3c8c26oDJKJ1HTjvdzHbYSZYkGmrzrhCF1JfsfSc` |
| COO (Signer 2) | `2Jr4EkEUKEqPM89SKqGvPdbB2urZcmF1Yn6gNbUDdtE4` |

## Squads Multisig

| Item | Value |
|------|-------|
| Multisig Type | Squads v4 |
| Threshold | 2 of 2 |
| Master Vault | `6YZBADsF1M2TAKLdPgXXED6pGxrAoy5sirA1S4kCyLWy` |

## Program IDs (Mainnet)

| Program | Program ID | Deploy TX |
|---------|-----------|-----------|
| gndk-registry | `32i3NpTZBAULDBgvPB4nyY48LpEW6LBXJ3uzsHdE8uWN` | `42gme9uTHyPstEArzd2iNtLg4NJUsj3tBKxUHvhQWgHmk7xjbwxFJZyqCTTLXhT6w4KaW15YJk3wQzsBKjQ9ng6A` |
| l2e-module | `HpisvtB1A5d7RYFn9QviVVgeYUhEk31G1o9moxPHcSAU` | `be4w8cQKiSBTjBtEhgEBdzKwMzjRmWCjqygB4uJCtezGjPdPQsA4APeEqjx5RKghtZpBVZfEDm5BAAzbQkYYLTP` |
| burn-recycle | `7iTHn5VfdbuB6iZMRMWEEcvsDZ6tp4PJc2LSApkGsEKt` | `3XNXsGqYMcKFCE1objZCo8MxV3TKVKbspp8FhC5bfw8W8Zz56sSgRGzgjRmhjYgSyWfCiC1u4nftf9CdcyRA7E6B` |
| vesting-program | `2H2nr7E2F4CFPEwacmAwtBu5YXjF5LjqrMXyt2phQWMq` | `5BdNgART2x2PXewwuhkANA3LwuVNpK3okHtvvQmhJ8p2xnSXW57dorCUitXivMwKu727LNZ7aLbGabF5U8EYCJGs` |

## Program IDs (Devnet) — Reference

| Program | Program ID |
|---------|-----------|
| gndk-registry | `6SZBJmypA1eC6R8C8iPXSRZevwT5bFPuAEcBbSrk1srw` |
| l2e-module | `Ed1GRcVHtXq1fJxwN8SC7rWjmwC4S6kVRGoXKkmv6AkS` |
| burn-recycle | `EV5A8bfAyqYqgscwd2PRoHfTqPg9w7Uxuwgmo4TTYzXp` |
| vesting-program | `6w23izAP5v6WzqA9eAgb96WvWtckKbquhKbPfXmgMwok` |

## Token Distribution Plan (Whitepaper v3.1 — reallocated 2026-09-22)

> v3.0 (TGE 2026-04-04) 배분과 변경 절차는 아래 "Reallocation 2026-09-22" 절. 현재 유효한 배분은 이 표.

| Category | Amount | % | Destination | Condition |
|----------|--------|---|-------------|-----------|
| MYPOOL Ecosystem | 120,000,000 | 12% | Registry RewardPool PDA | Dynamic Halving |
| Ganadara Ecosystem | 180,000,000 | 18% | Registry RewardPool PDA | Dynamic Halving |
| Charitable | 50,000,000 | 5% | Squads Master Vault | Immediately available |
| Early Contributors — vested | 123,000,000 | 12.3% | Vesting PDA (100M + 23M) | Cliff 1yr + Linear 1yr |
| Early Contributors — distributed | 77,000,000 | 7.7% | Paid out from Squads Master Vault (TGE ~ 2026-09) | Unlocked |
| Private Sale | 50,000,000 | 5% | Vesting PDA | Cliff 1yr + Linear 1yr |
| Team/Advisors | 50,000,000 | 5% | Vesting PDA | Cliff 1yr + Linear 2yr |
| Foundation | 180,000,000 | 18% | Squads Master Vault | Immediately available |
| Marketing | 100,000,000 | 10% | Squads Master Vault | Immediately available |
| Partnerships | 70,000,000 | 7% | Squads Master Vault | Immediately available |
| **Total** | **1,000,000,000** | **100%** | | |

### Summary by Destination (2026-09-22, on-chain verified)

| Destination | Amount |
|-------------|--------|
| Registry RewardPool PDA | 300,000,000 |
| Vesting Vault PDA | 223,000,000 |
| Squads Master Vault | 399,999,700 (400M − 300 spent) |
| Early Contributors (already distributed) | 77,000,000 |
| Burned (BurnRecycle) | 218 |
| **Total** | **1,000,000,000** |

## Reallocation 2026-09-22 (Whitepaper v3.0 → v3.1)

CEO 결정(2026-09-22): 초기 기여자 10%→20% · 프라이빗 세일 10%→5% · 마케팅 15%→10%. 총량 불변, 추가 발행 없음, 프로그램 코드 변경 없음(Certik 감사 범위 그대로).
초기 기여자 20% 에는 Squads 볼트에서 이미 지급된 77M 이 포함된다(즉시 지급 7.7% + 베스팅 12.3%).
스크립트 `scripts/reallocate-2026-09.ts`(dry-run 기본, 재개형) · 실행 기록은 리포 밖 키 디렉토리에 보관.

v3.0 배분(참고): Early Contributors 100M(10%) · Private Sale 100M(10%) · Marketing 150M(15%) — 나머지 항목 동일.

| Step | Action | Amount | TX |
|------|--------|--------|----|
| 1 | revoke `privateSale` (cliff 미도래 → 전량 미해제) → Deployer ATA | 100,000,000 | `9G29zxB9PAwBwgn2iMtUQM1k6T4D6FWVvdBX89gTA59umqj514yxA48NtRpjqCGKetgsvqXHjymR11tzswrHQLs` |
| 2 | create_vesting `privateSale2` (기존 privateSale 만기에 정렬) | 50,000,000 | `3y4GrcckTWTQhoa9pXCn8a42RpVu4UoPXPSAJKaqFXSWsewksK9nD9kbHeNFuyKUKNcLMVb46h7vYvSx9gucjJCY` |
| 3 | create_vesting `earlyContrib2` (기존 earlyContrib 만기에 정렬) | 23,000,000 | `3D49gsspPXy567q3jGhmrKyaWwSJP9kjPW4k7jXAWHPQXF1hBZK16HsFPdYtKV1NqtGBAfKim1K1rQTCQb4QBM6u` |
| 4 | transfer Deployer ATA → Squads Master Vault ATA (`4BHeRNbjpDKnKjtRT2ErJEZ5BbMzBTGQVYLf5pCvMpvc`) | 27,000,000 | `CVyAmM6hosbTem5pgv8K8a6UEuXonEgz7KJVNR7cz3RajA7RjeVaqJLLrE2SxhVqehi7mxPMgCdAGap1gg6ULWc` |

검증(실행 직후): Deployer ATA 0 · Vesting Vault 223,000,000 = 미해제 스케줄 합계 · Squads Vault 399,999,700. Squads 2인 서명은 불필요했다(볼트로 입금만).

Devnet: 리허설을 위해 감사 완료 빌드를 devnet 에 **메인넷 program id `2H2nr7…` 로 재배포**했다(기존 devnet `6w23…` 은 감사 전 빌드라 계정 순서가 현재 IDL 과 맞지 않는다). 리허설 상태 `scripts/rehearsal-devnet-state.json`.

## TGE (Token Generation Event) — Completed 2026-04-04

| Item | Value |
|------|-------|
| GNDK Mint | `fksRmeMUXV3o3UzFtJ48BpoQoKkUhrYyXpCzXmsR3EF` |
| Vesting Vault ATA | `EUyWmwbVi3HL88WrA5QDu7fDoQLgUohT4RhiaP1sNwdK` |

### Vesting Beneficiaries

| Category | Amount | Beneficiary Address |
|----------|--------|-------------------|
| Early Contributors | 100,000,000 | `E7X9fb39kiiGnZX2hwdVxaRFrahPFV888uH4gCc8H831` |
| Early Contributors 2 (2026-09-22) | 23,000,000 | `DR3tgWkRhWQQSAXCmDvPYWzyjShzzJPyAjzXrVjmFYmy` (PDA `tQgMT22fCRTaoZDztjS75nPFVBSBhNEPFyNeThkEQws`) |
| ~~Private Sale~~ (revoked 2026-09-22) | ~~100,000,000~~ → 0 | `6prAFw5kumsuQ2uoskAzFkFCeJqeAR84fAaf7x2vpA6N` |
| Private Sale 2 (2026-09-22) | 50,000,000 | `44Za3JtfncQ2vVzpfpaJkUCBgWqqXnRduw6xSc7GLKK5` (PDA `BFtLwDSY7JQZUqJeZ53qPJEXYnRbELvYaByyjkjJWfH`) |
| Team/Advisors | 50,000,000 | `BWMNgafspwzQSyNnTbwyPMcGLQxCZRqxQgzTHCNJREdx` |

### Distribution Verification (TGE 2026-04-04 — 현재값은 위 "Summary by Destination")

| Location | Balance | Status |
|----------|---------|--------|
| L2E RewardPool PDA | 300,000,000 GNDK | Confirmed |
| Squads Master Vault | 450,000,000 GNDK | Confirmed |
| Vesting Vault PDA | 250,000,000 GNDK | Confirmed |
| Deployer Wallet | 0 GNDK | Confirmed |
| **Total** | **1,000,000,000 GNDK** | **All distributed** |

## Deployment Cost

| Item | SOL |
|------|-----|
| Starting Balance | 20.005 |
| Program Deploys (4) | ~9.324 |
| TGE Transactions | ~0.020 |
| Remaining | ~10.661 |

## Key Material

All keypairs (deployer, program upgrade, vesting beneficiaries) and TGE state files are held outside this repository. Operators: see the internal key inventory kept alongside the key files.

## Token Metadata

| Item | Value |
|------|-------|
| Name | GANADA TOKEN |
| Symbol | GNDK |
| Logo (Arweave) | `https://gateway.irys.xyz/HnX7nyQC6VAJQiUQxoQ6bAHk7b2KuC5nC4UY4tgU5VTF` |
| Metadata JSON (Arweave) | `https://gateway.irys.xyz/RWeDwmDsuUH8deDe63Zdd94C5mCgzBusRAXdWk2WoCw` |

## Vesting Claim 운영 가이드

### 개요

Vesting에 잠긴 토큰은 cliff 기간(1년) 이후부터 선형(linear)으로 해제됩니다.
해제된 토큰은 자동으로 지갑에 들어오지 않고, **claim 스크립트를 실행**해야 합니다.

### 해제 스케줄

| 항목 | Cliff (잠금) | Linear (해제) | 최초 claim 가능 시점 | 전량 해제 시점 |
|------|-------------|--------------|-------------------|-------------|
| Early Contributors (100M) | 1년 | 1년 | 2027-04-04 | 2028-04-04 |
| Early Contributors 2 (23M) | (2027-04-04 에 정렬) | 1년 | 2027-04-04 | 2028-04-04 |
| Private Sale 2 (50M) | (2027-04-04 에 정렬) | 1년 | 2027-04-04 | 2028-04-04 |
| Team/Advisors (50M) | 1년 | 2년 | 2027-04-04 | 2029-04-04 |

### 실행 방법

1. **실행 환경**: 오퍼레이터 노트북 또는 CEO 컴퓨터 (Node.js + gndk-token 프로젝트 필요)
2. **필요 파일**: 해당 항목의 beneficiary keypair (CEO 보관)
   - `earlyContrib-keypair.json` · `earlyContrib2-keypair.json`
   - `privateSale2-keypair.json` (구 `privateSale-keypair.json` 은 revoke 되어 사용 불가)
   - `teamAdvisor-keypair.json`
3. **실행 명령** (추후 스크립트 작성 예정):
   ```bash
   npx ts-node scripts/vesting-claim.ts --schedule earlyContrib
   ```
4. **동작**: 현재 시점까지 해제된 금액을 beneficiary 지갑으로 전송
5. **여러 번 실행 가능**: 한번에 전부 안 가져와도 됨, 원하는 시점에 반복 claim

### Admin 작업 (Revoke)

문제 발생 시 admin(Deployer 지갑)이 미해제분을 회수할 수 있습니다.
- Deployer keypair 필요 (리포 밖, 내부 키 인벤토리 참조)

## Pending Steps

- [x] Phase 2: Program Deploy
- [x] Phase 3: TGE (Token Generation Event)
- [x] Phase 4: Upgrade Authority → Squads Vault (4개 프로그램 모두 완료)
- [ ] Phase 5: Keystone Hardware Wallet Migration (~4/10)
- [ ] Phase 6: Mint Authority Disable (after Keystone)
- [ ] Phase 7: Verified Build + Final Verification
