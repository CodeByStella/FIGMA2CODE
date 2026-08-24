# Debug UI

Next.js host that mounts `packages/plugin-ui` with **mock** conversion data. Useful for layout/CSS work without Figma.

```bash
# from repo root
pnpm dev:debug
```

Open [http://localhost:3000](http://localhost:3000).

This app **cannot** read a Figma file or run real conversion. For that, build/watch `apps/plugin` and run the development plugin in Figma Desktop — see [docs/user-guide.md](../../docs/user-guide.md).
