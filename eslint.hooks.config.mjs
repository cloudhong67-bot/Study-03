// `npm run lint:hooks` 전용 설정: 최신 react-hooks 규칙(v7, React Compiler 계열)으로 src를 검사한다.
//
// Next 15의 lint 설정(eslint-config-next)은 react-hooks 5.x에 묶여 있어, 렌더 중 ref 접근(refs),
// effect 안 동기 setState(set-state-in-effect), 렌더 순수성(purity) 같은 규칙을 검사하지 못한다.
// v7은 별칭(eslint-plugin-react-hooks-v7)으로 설치해 기존 플러그인과 이름이 겹치지 않게 하고,
// 설정도 이 파일로 분리해 `npm run lint`(eslint.config.mjs)와 섞이지 않게 한다.
//
// Next 16으로 올리면 기본 lint에 이 규칙들이 들어가므로, 그때 이 파일과 lint:hooks 명령을 지운다.
import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks-v7";

const hooksLintConfig = [
  { ignores: [".next/**", "node_modules/**"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: "module" },
    },
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs["recommended-latest"].rules,
  },
];

export default hooksLintConfig;
