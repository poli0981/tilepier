# `lib/lunar` — Vietnamese lunar calendar

## Credit

The algorithm is **Hồ Ngọc Đức's**, published with his Vietnamese lunar
calendar work and widely reimplemented since. It computes the lunar month
boundaries from the astronomical new moon and the sun's ecliptic longitude
following Jean Meeus's _Astronomical Algorithms_, evaluated at **UTC+7**.

The implementation here is in-house — no code was copied from any published
implementation — and is carried over from QuoteAtlas, a sibling project of this
one, together with its test vectors. Doc 16 §5 requires the credit line above to
appear both here and on `/legal/licenses`; it does so in both places.

## What "pinned to UTC+7" does and does not mean

doc 07 §6 fixes the lunar computation to Asia/Ho_Chi_Minh "regardless of viewer
zone". That is a statement about the **conversion**, not about which date the UI
shows. A new-moon boundary falls at an instant, so computing it against the
browser's own offset would put whole lunar months a day out for anyone abroad —
moving Tết for exactly the reader it matters most to. Hence `timeZone = 7`
everywhere, and `lunarOfDate` taking a calendar date rather than an instant, so
there is no clock for a zone to leak in through.

Which calendar date a viewer is _on_ stays local. A printed Vietnamese calendar
answers "what lunar date is 30 August" for every reader on earth and leaves "what
day is it" to the reader; this module does the same. Doing it the other way round
— showing everyone Vietnam's current lunar day — makes the clock tile contradict
itself for eight hours a day in California, with the solar date on the line
reading the 30th and the lunar date beside it belonging to the 31st.

## Why this exists at all

`Intl`'s `chinese` calendar computes at UTC+8 and **genuinely diverges from the
Vietnamese calendar**. The clearest case is Tết 2007: Vietnam observed it on
17 February, the UTC+8 calendar places the new year on the 18th. 1968 and 1985
diverge too. For an app built around Vietnamese identity (doc 12 §1) that is the
one date it most needs right, so `Intl` is not used for display.

It _is_ used as the **oracle**. Every day from 1900 to 2100 is compared against
it in `amlich.test.ts`, which is a different codebase reaching the same
astronomy one hour east. Where the two agree both are almost certainly right;
where they differ it has to be a difference `__fixtures__/amlich-vectors.json`
records and a human has looked at — six substantive runs across two centuries.

## Do not change the maths without the vectors

`__fixtures__/amlich-vectors.json` is generated and human-signed-off
(`_verified: true`). Its `crossCheck` block carries three counts —
73 414 days compared, 2 667 disagreeing, 84 runs — and `amlich.test.ts` asserts
all three. **If a change moves any of those numbers, the change is wrong, not
the fixture.** The frozen `pairs` are produced by this module and so are a
regression net rather than proof; the proof is the cross-check plus the
invariants (every lunar day 1–30, every complete month 29 or 30 days, every day
round-trips).

Two dates earn their own regression test. `2054-05-07` and `2062-04-09` returned
**lunar day 0** under the usually-published form of the algorithm, which steps
the mean-synodic month estimate back exactly once where a true lunation can run
far enough from the mean to need two steps. A round-trip property cannot catch
it — `convertLunar2Solar(0, 4, 2054)` maps straight back — which is why the
day-range invariant exists.

## Surface

| Export                                      | For                                                     |
| ------------------------------------------- | ------------------------------------------------------- |
| `lunarOfDate(solar)`                        | the lunar date of a calendar date — the core of it      |
| `lunarOf(at)`                               | the same, for the date an instant falls on              |
| `solarOfLunar(lunar)`                       | the detail panel's converter, running backwards         |
| `convertSolar2Lunar` / `convertLunar2Solar` | the raw maths, unguarded, for the vector suite          |
| `julianDayOf(solar)`                        | the day-level can-chi cycle counts in Julian days       |
| `SUPPORTED_RANGE` / `isSupportedYear`       | doc 07 §6's 1900–2100 guard                             |
| `format.ts`                                 | `canChiYear/Month/Day`, `fmtLunarShort`, `fmtLunarLong` |

The guarded functions return `null` outside 1900–2100 and for a leap month a
year does not have, so no caller has to recognise `{ d: 0, m: 0, y: 0 }` as a
failure.

`solarTermDate` from the original port is deliberately **not** carried: nothing
in docs 07–09 asks for tiết khí, and knip is CI-blocking on an export with no
consumer (doc 20 §4). It is in QuoteAtlas's history if it is ever wanted.

## The can-chi trio has different evidence behind it

`canChiYear` is covered by the fixture — all 201 Tết rows carry the year's
can-chi. **`canChiMonth` and `canChiDay` were added here and the vectors say
nothing about them.** `format.test.ts` therefore checks each against the _rule_
it implements rather than against its own output: the fixed month-branch table
(tháng Giêng is always Dần), the ngũ hổ độn stem rule over a full twenty-year
span, and — for days — the published anchor that 1 January 2000 is JDN 2 451 545
and a Mậu Ngọ day.
