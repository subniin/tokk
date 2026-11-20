// Type of the virtual module that scripts/build.ts fills with the bundled Worker source.
declare module 'tokk:worker-source' {
  const source: string;
  export default source;
}
