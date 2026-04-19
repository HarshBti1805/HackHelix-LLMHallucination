import type { Metadata } from "next";
import localFont from "next/font/local";
import { Instrument_Sans } from "next/font/google";
import { ThemeProvider } from "@/components/ThemeProvider";
import "./globals.css";

/*
 * Local typefaces live in /public/fonts. We expose every face the design
 * system might reach for via a CSS variable so a component can opt in to
 * a specific voice (display, body, mono, accent) without re-declaring
 * the @font-face. The defaults wired into Tailwind's `font-serif`,
 * `font-sans` and `font-mono` are chosen for readability:
 *   - Instrument Serif: editorial, used for titles + hero copy
 *   - Manrope: workhorse body sans
 *   - DM Mono: warm monospace for code / kbd / metadata
 * Other faces (Playfair, Space Grotesk, Avenir, etc.) are loaded so they
 * are reachable from any component via their `--font-*` variable.
 */

const instrumentSerif = localFont({
  src: [
    {
      path: "../public/fonts/InstrumentSerif-Regular.ttf",
      weight: "400",
      style: "normal",
    },
    {
      path: "../public/fonts/InstrumentSerif-Italic.ttf",
      weight: "400",
      style: "italic",
    },
  ],
  variable: "--font-instrument-serif",
  display: "swap",
});

const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
  display: "swap",
});

const manrope = localFont({
  src: "../public/fonts/Manrope-Regular.ttf",
  variable: "--font-manrope",
  display: "swap",
});

const dmMono = localFont({
  src: "../public/fonts/DMMono-Regular.ttf",
  variable: "--font-dm-mono",
  display: "swap",
});

const spaceGrotesk = localFont({
  src: "../public/fonts/SpaceGrotesk-Regular.ttf",
  variable: "--font-space-grotesk",
  display: "swap",
});

const spaceMono = localFont({
  src: "../public/fonts/SpaceMono-Regular.ttf",
  variable: "--font-space-mono",
  display: "swap",
});

const playfair = localFont({
  src: "../public/fonts/PlayfairDisplay.ttf",
  variable: "--font-playfair",
  display: "swap",
});

const libreBaskerville = localFont({
  src: "../public/fonts/LibreBaskerville.ttf",
  variable: "--font-libre-baskerville",
  display: "swap",
});

const avenirNext = localFont({
  src: "../public/fonts/AvenirNextLTPro-Regular.otf",
  variable: "--font-avenir-next",
  display: "swap",
});

const ttCommons = localFont({
  src: "../public/fonts/TTCommons.otf",
  variable: "--font-tt-commons",
  display: "swap",
});

const neueMachina = localFont({
  src: "../public/fonts/NeueMachina-Regular.otf",
  variable: "--font-neue-machina",
  display: "swap",
});

const akrobat = localFont({
  src: "../public/fonts/Akrobat-Regular.otf",
  variable: "--font-akrobat",
  display: "swap",
});

const syne = localFont({
  src: "../public/fonts/Syne.ttf",
  variable: "--font-syne",
  display: "swap",
});

const poppins = localFont({
  src: "../public/fonts/Poppins.ttf",
  variable: "--font-poppins",
  display: "swap",
});

const raleway = localFont({
  src: "../public/fonts/Raleway.ttf",
  variable: "--font-raleway",
  display: "swap",
});

const montserrat = localFont({
  src: "../public/fonts/Montserrat.ttf",
  variable: "--font-montserrat",
  display: "swap",
});

const josefinSans = localFont({
  src: "../public/fonts/JosefinSans-Regular.ttf",
  variable: "--font-josefin",
  display: "swap",
});

const arvo = localFont({
  src: "../public/fonts/Arvo-Regular.ttf",
  variable: "--font-arvo",
  display: "swap",
});

const violetSans = localFont({
  src: "../public/fonts/VioletSans-Regular.ttf",
  variable: "--font-violet-sans",
  display: "swap",
});

const bogitaMono = localFont({
  src: "../public/fonts/BogitaMono-Regular.otf",
  variable: "--font-bogita-mono",
  display: "swap",
});

const broadway = localFont({
  src: "../public/fonts/Broadway.ttf",
  variable: "--font-broadway",
  display: "swap",
});

const vonique = localFont({
  src: "../public/fonts/Vonique64-JKgM.ttf",
  variable: "--font-vonique",
  display: "swap",
});

const fontVariables = [
  instrumentSerif.variable,
  instrumentSans.variable,
  manrope.variable,
  dmMono.variable,
  spaceGrotesk.variable,
  spaceMono.variable,
  playfair.variable,
  libreBaskerville.variable,
  avenirNext.variable,
  ttCommons.variable,
  neueMachina.variable,
  akrobat.variable,
  syne.variable,
  poppins.variable,
  raleway.variable,
  montserrat.variable,
  josefinSans.variable,
  arvo.variable,
  violetSans.variable,
  bogitaMono.variable,
  broadway.variable,
  vonique.variable,
].join(" ");

export const metadata: Metadata = {
  title: "Groundtruth",
  description:
    "Groundtruth — multi-agent hallucination auditor for LLM chat responses.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${fontVariables} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full bg-background text-foreground flex flex-col">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
