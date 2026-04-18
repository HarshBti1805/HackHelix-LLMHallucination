"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

/**
 * Client-only wrapper around next-themes.
 *
 * We pulled this out into its own client component so the root layout can
 * stay a pure server component (which preserves the metadata pipeline and
 * keeps RSC streaming intact).
 *
 * Props worth flagging:
 *   - attribute="class"            → toggles `class="dark"` on <html>, which
 *                                    matches our Tailwind v4 `@custom-variant
 *                                    dark` selector in globals.css.
 *   - defaultTheme="system"        → first-visit users follow OS preference.
 *   - enableSystem                 → keeps the "system" option live so OS
 *                                    changes propagate without a reload.
 *   - disableTransitionOnChange    → prevents the colour-mix transition flash
 *                                    on theme toggle (cleaner than ours).
 *
 * next-themes injects its own no-flash bootstrapper without rendering a
 * `<script>` element into the React tree, which is what the previous inline
 * script tripped on under Next 16 / React 19.
 */
export function ThemeProvider(
  props: ComponentProps<typeof NextThemesProvider>,
) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    />
  );
}
