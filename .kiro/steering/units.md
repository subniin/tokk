---
inclusion: always
---

# Unit rules

- Write every threshold and time constant in ms, Hz or dB, with the unit in the name.
- Never hard-code a sample count. Derive it from the sample rate and a constant.
- Keep the constants in `core/constants.ts`.
- Compute every time `t` as a cumulative sample count divided by the sample rate, in seconds.
