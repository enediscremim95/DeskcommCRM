import localFont from "next/font/local";

// Note: next/font requires module-level constants; we expose all 4 pair vars
// at once. CSS swaps via --font-display / --font-body / --font-mono picker.

export const bricolage = localFont({
  src: "../../fonts/bricolagegrotesque/BricolageGrotesque[opsz,wdth,wght].woff2",
  weight: "200 800",
  display: "swap",
  variable: "--font-bricolage",
});

export const jakarta = localFont({
  src: "../../fonts/plusjakartasans/PlusJakartaSans[wght].woff2",
  weight: "200 800",
  display: "swap",
  variable: "--font-jakarta",
});

export const fraunces = localFont({
  src: "../../fonts/fraunces/Fraunces[SOFT,WONK,opsz,wght].woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-fraunces",
});

export const manrope = localFont({
  src: "../../fonts/manrope/Manrope[wght].woff2",
  weight: "200 800",
  display: "swap",
  variable: "--font-manrope",
});

export const atkinson = localFont({
  src: [
    { path: "../../fonts/atkinsonhyperlegible/AtkinsonHyperlegible-Regular.woff2", weight: "400", style: "normal" },
    { path: "../../fonts/atkinsonhyperlegible/AtkinsonHyperlegible-Bold.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-atkinson",
});

export const sourceSerif = localFont({
  src: "../../fonts/sourceserif4/SourceSerif4[opsz,wght].woff2",
  weight: "200 900",
  display: "swap",
  variable: "--font-source-serif",
});

export const plexSans = localFont({
  src: "../../fonts/ibmplexsans/IBMPlexSans[wdth,wght].woff2",
  weight: "300 700",
  display: "swap",
  variable: "--font-plex-sans",
});

export const plexMono = localFont({
  src: [
    { path: "../../fonts/ibmplexmono/IBMPlexMono-Regular.woff2", weight: "400", style: "normal" },
    { path: "../../fonts/ibmplexmono/IBMPlexMono-Medium.woff2", weight: "500", style: "normal" },
  ],
  display: "swap",
  variable: "--font-plex-mono",
});

export const jetbrains = localFont({
  src: "../../fonts/jetbrainsmono/JetBrainsMono[wght].woff2",
  weight: "100 800",
  display: "swap",
  variable: "--font-jetbrains",
});

export const allFontVariables = [
  bricolage.variable,
  jakarta.variable,
  fraunces.variable,
  manrope.variable,
  atkinson.variable,
  sourceSerif.variable,
  plexSans.variable,
  plexMono.variable,
  jetbrains.variable,
].join(" ");
