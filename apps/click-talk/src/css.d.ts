// A .css file is imported as text with an import attribute (`with { type: 'text' }`), which esbuild reads as its text loader.
// main.ts puts the text into the page, because the site build copies only dist/app.js.
declare module '*.css' {
  const text: string;
  export default text;
}
