# Brand assets and provider identity

## Recommendation

Keep brand identity separate from usage-state visualization.

Render:

```text
official/approved provider mark
        +
UsageHalo-owned usage ring
```

Do not recolor or distort provider marks to indicate warning/critical state.

## Repository policy

This scaffold ships **neutral monogram placeholders**, not copied third-party trademarks. Production builds should use a reviewed brand asset registry.

Each provider asset record should include:

- provider ID;
- display name;
- asset path;
- source URL;
- trademark/brand guideline URL;
- asset license/permission note;
- light/dark variants;
- last review date.

## Sources

Simple Icons can be useful as a development source for many SVG marks, but its project license does not automatically grant trademark rights to every individual logo. Review provider-specific brand guidance.

Useful references:

- Simple Icons: https://github.com/simple-icons/simple-icons
- Simple Icons disclaimer: https://github.com/simple-icons/simple-icons/blob/develop/DISCLAIMER.md
- OpenAI brand: https://openai.com/brand/
- Google brand resource center: https://about.google/brand-resource-center/guidance/

## Fallback icon

For unsupported or unreviewed brands, use a UsageHalo-generated letter mark based on provider display name. Never scrape a random image result into the application.

## Accent colors

Provider accent colors may be used for rings/cards only when they do not violate provider brand rules. UsageHalo state colors must remain semantic and accessible.
