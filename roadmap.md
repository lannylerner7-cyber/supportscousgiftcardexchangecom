# ScousGiftCardExchange — Build Roadmap (living blueprint)

Status key: [ ] not started · [~] in progress · [x] done

## Phase 1 — Foundation

- [x] Lovable Cloud enabled
- [x] Database: all tables, indexes, row-level security, grants
- [x] Roles in separate `user_roles` table + `has_role()` check
- [x] Private storage buckets for card proofs and chat images
- [x] Brand design tokens (deep-night navy/charcoal, gold-green money accents, display typeface)
- [x] Display + body fonts loaded (Bricolage Grotesque, Manrope)
- [x] Shared 5-second branded page loader
- [x] Motion kit: card tilt, counting balance, shimmer skeletons, confetti, chime/alert sounds
- [x] Seeded admin account (owner email + password, admin role in `user_roles`)

## Phase 2 — Public site

- [x] Homepage: hero, live rate ticker, campaign banners, brand grid
- [x] Rates page with search
- [x] Support / FAQ page
- [x] Terms and Privacy pages
- [x] Mobile navigation + footer
- [x] Real brand logos (Simpleicons + Google logo service, letter fallback)
- [x] Hero artwork, floating motion, auto-rotating banner carousel
- [x] Show/hide eye toggle on every password field
- [ ] Real Canva artwork (placeholders in place)
- [ ] App icon and splash screens

## Phase 3 — Accounts

- [x] Signup (name, email, phone, password)
- [x] 6-digit code screens with resend cooldown (60s) and hourly cap
- [x] Login: unknown email message, 3 failed attempts = 30-minute lock with unlock time
- [x] Forgot password + set new password
- [x] Protected member area + logout
- [~] Email delivery: code and welcome emails are written but cannot be sent until a
      sending domain is connected. Until then new accounts are verified immediately.
- [ ] Profile page + unverified ribbon
- [ ] Delete exchange account (typed DELETE + password, blocked if balance/pending)
- [ ] Admin mail-settings screen

## Phase 4 — Trading

- [x] Member dashboard: balance with hide/show, counting animation, recent trades
- [ ] Market grid with brand tiles
- [ ] Region picker (US, UK, DE, AU, CA, IT, FR, CH, NZ, JP, AE, SG)
- [ ] Physical vs e-code paths
- [ ] Live Naira payout preview
- [ ] Photo upload 1–5 / code + PIN
- [ ] Exchange history + status timeline + admin note

## Phase 5 — Money out

- [ ] Bank accounts (add/delete/default)
- [ ] Withdrawal request, ₦300 fee, total before confirm
- [ ] Balance held at request time
- [ ] Wallet ledger
- [ ] Refunds and manual deductions

## Phase 6 — Admin panel (`/ScousGiftCardExchange/admin`)

- [ ] Overview
- [ ] Trade queue, unattended badge, sound alert
- [ ] Approve / decline / partial with note
- [ ] Rates per brand + region + value band
- [ ] Market visibility
- [ ] Users: balances, banks, manual credit/debit
- [ ] Withdrawal queue
- [ ] Banner manager
- [ ] Notification broadcaster
- [ ] Mail settings
- [ ] Audit log

## Phase 7 — Chat and notifications

- [ ] Chat with admin (text + images, trade context)
- [ ] Sound alerts wired to live events
- [ ] Notification centre
- [ ] Push notifications

## Phase 8 — App packaging

- [ ] PWA manifest + service worker + offline shell
- [ ] Icons and splash screens
- [ ] Store listing assets
- [ ] Capacitor wrap

## Phase 9 — Hardening and launch

- [ ] Security review
- [ ] Rate limits
- [ ] Duplicate-card fraud checks
- [ ] Load test
- [ ] Submission checklist

## Open items

- Starting rates per brand/region — set in the admin panel at launch
- Email sending domain — needed before codes and welcome emails can actually be delivered
- Referrals — not scheduled yet
- Canva exports — swap in when ready
- Backend is your own Cloudflare D1 database plus R2 file storage

## Phase 10 — Requested 20 Sep

- [ ] Welcome bonus: ₦5,000 on signup, locked until the member's first successful trade
- [ ] Referrals: ₦2,000 to both sides, locked until each side trades
- [ ] Locked (non-withdrawable) balance shown separately in wallet and admin
- [x] Cloudflare: own D1 database + R2 file storage — the whole app now runs on them
- [ ] .env / secrets fully populated: SMTP + sender identity

### Phase 10 progress (22 Sep)
- [x] Welcome bonus ₦5,000 locked until first redeemed card
- [x] Referral codes — ₦2,000 both sides, locked until each trades
- [x] Locked balance shown on dashboard, excluded from withdrawals
- [x] Homepage contact form -> admin Messages + email alert
- [ ] SMTP secrets still needed from the user before any email sends
- [x] Cloudflare D1 / R2 — done: 24 tables, 67 indexes, private file bucket `scous-proofs`

## Phase 11 — Requested 28 Sep

- [x] Real card artwork supplied by the owner: 20 of 22 brands now use pictures stored in this project (Foot Locker and Netflix were not in the list, so they keep the letter badge)
- [ ] Decide whether brands in the artwork list that are not yet tradable (Macy's, Walmart, Sephora, Nordstrom, Visa, Roblox, Uber Eats, DoorDash, …) should be added to the market with their own rates
- [x] Cloudflare mail sending configured and verified end to end: a real code was emailed, accepted on the reset page and signed the account in
