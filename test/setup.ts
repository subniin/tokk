import fc from 'fast-check';

// Number of cases per property test. Set with the PBT_RUNS environment variable.
const runs = Number(process.env.PBT_RUNS ?? '100');

fc.configureGlobal({ numRuns: Number.isFinite(runs) && runs > 0 ? runs : 100 });
