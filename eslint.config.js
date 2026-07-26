import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import svelte from 'eslint-plugin-svelte'
import svelteParser from 'svelte-eslint-parser'
import svelteConfig from './svelte.config.js'
import { ZONE_RULES, deniedZoneImports } from './eslint.zones.js'

/**
 * The four prohibitions in docs/code-structure.md are lint rules rather than
 * conventions, because none of them can be satisfied by discipline alone:
 *
 *   1. engine/ and generation/ must not import PixiJS, Tone.js, Svelte, or any
 *      DOM global — that's what keeps them headless and testable.
 *   2. plugins/worker/ may import only shared/ — the worker bundle IS the trust
 *      boundary, and a boundary is only as good as its import graph.
 *   3. Only platform/ may import @tauri-apps/* or @capacitor/* — native
 *      capability gets exactly one door.
 *   4. Math.random() is banned everywhere, no exemptions.
 *
 * Note on flat-config semantics: `no-restricted-imports` is a single rule, so a
 * later block REPLACES an earlier one rather than adding to it. Every zone
 * therefore gets exactly one block stating its complete restriction set.
 */

/** Cross-zone imports must go through an alias so the rules above can see them. */
const ESCAPING_RELATIVE_IMPORT = {
  group: ['../../*', '../../**'],
  message:
    'Relative imports may not climb out of a top-level folder — use the zone alias (@engine/…, @shared/…) so the import-zone rules apply.',
}

const NATIVE_BRIDGE = {
  group: ['@tauri-apps/*', '@tauri-apps/**', '@capacitor/*', '@capacitor/**'],
  message:
    'Only src/platform/ may import native bridge APIs. Plugin code must never be able to reach them. See docs/code-structure.md.',
}

const RENDER_LIBS = {
  group: ['pixi.js', 'pixi.js/*', 'tone', 'tone/*', 'svelte', 'svelte/*'],
  message:
    'The trading engine and the generators must stay free of rendering, audio, and UI libraries so they can be unit tested headless. See docs/tech-stack.md#testing.',
}

const NO_MATH_RANDOM = {
  // One selector, not two — `Math.random` and `Math.random()` both match the
  // member expression, and adding the call form only double-reports.
  selector: "MemberExpression[object.name='Math'][property.name='random']",
  message:
    'Math.random() is banned repo-wide. Use the seeded PRNG in @shared/math, or mintSeed() for a new run seed. See docs/procedural-assets.md.',
}

/** DOM globals that would quietly couple pure logic to a browser. */
const DOM_GLOBALS = [
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'requestAnimationFrame',
  'performance',
  'fetch',
].map((name) => ({
  name,
  message:
    'This folder must run headless — take the value as an argument instead of reading a DOM global. See docs/code-structure.md.',
}))

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'src-tauri/**',
      'android/**',
      '.svelte-kit/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs.recommended,

  {
    files: ['**/*.ts', '**/*.svelte'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        extraFileExtensions: ['.svelte'],
        svelteConfig,
      },
    },
    rules: {
      'no-restricted-syntax': ['error', NO_MATH_RANDOM],
      'no-restricted-imports': ['error', { patterns: [NATIVE_BRIDGE] }],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // TypeScript already resolves identifiers, and it knows about DOM/Node
      // globals that the base rule's environment list does not.
      'no-undef': 'off',
    },
  },

  // Svelte components and `.svelte.ts` rune modules need the Svelte parser for the
  // markup and the TypeScript parser for what's inside <script lang="ts">.
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parser: svelteParser,
      parserOptions: {
        parser: tseslint.parser,
        projectService: true,
        extraFileExtensions: ['.svelte'],
        svelteConfig,
      },
    },
  },

  // One complete block per zone, generated from the dependency table.
  ...Object.entries(ZONE_RULES).map(([dir, { allow, pure, native }]) => {
    const denied = deniedZoneImports(allow)
    return {
      files: [`${dir}/**/*.ts`, `${dir}/**/*.svelte`],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: denied.paths,
            patterns: [
              ...denied.patterns,
              ESCAPING_RELATIVE_IMPORT,
              ...(native ? [] : [NATIVE_BRIDGE]),
              ...(pure ? [RENDER_LIBS] : []),
            ],
          },
        ],
        ...(pure ? { 'no-restricted-globals': ['error', ...DOM_GLOBALS] } : {}),
      },
    }
  }),

  // Tests assert against their neighbours and reach for shared fixtures.
  {
    files: ['**/*.test.ts', 'tests/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
      'no-restricted-globals': 'off',
      'no-console': 'off',
    },
  },

  {
    files: ['*.config.js', '*.config.ts', 'eslint.zones.js'],
    rules: { 'no-restricted-imports': 'off', 'no-undef': 'off' },
  }
)
