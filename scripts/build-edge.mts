// Supabase Edge Function(ai-draft)을 한 파일로 묶는다: npm run build:edge
// lib/ai.ts·schema.ts·validator.ts를 그대로 함께 묶어서 AI 초안 코드를 한 벌만 유지한다.
// validator가 쓰는 표준모델(1.5MB)은 통째로 넣지 않고, 검사에 필요한 법 조항 목록만 뽑아 넣는다.
import { build } from "esbuild";
import { KNOWN_LAW_REFS } from "../lib/standard-models";

const refs = JSON.stringify([...KNOWN_LAW_REFS].sort());

await build({
  entryPoints: ["supabase/functions/ai-draft/source.ts"],
  outfile: "supabase/functions/ai-draft/index.js",
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  charset: "utf8",
  external: ["npm:*"],
  // lib/ai.ts는 process.env로 모델·시간 설정을 읽는다. Deno에서도 같은 이름으로 읽게 한다.
  banner: {
    js:
      "// 자동 생성 파일: 고치지 말고 supabase/functions/ai-draft/source.ts와 lib/ai.ts를 고친 뒤 npm run build:edge\n" +
      "globalThis.process ??= { env: Deno.env.toObject() };",
  },
  plugins: [
    {
      name: "law-refs-only",
      setup(b) {
        b.onResolve({ filter: /\/standard-models$/ }, () => ({ path: "standard-models", namespace: "refs" }));
        b.onLoad({ filter: /.*/, namespace: "refs" }, () => ({
          contents: `export const KNOWN_LAW_REFS = new Set(${refs});`,
          loader: "js",
        }));
      },
    },
  ],
  logLevel: "info",
});
