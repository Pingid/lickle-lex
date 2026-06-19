import { defineConfig, Layout } from '@lickle/docs/config'

export default defineConfig({
  name: '@lickle/lex',
  tsconfig: 'tsconfig.esm.json',
  layout: Layout.grouping(
    Layout.composeGroups(
      Layout.groupByKind,
      Layout.groupByTag(
        '@group',
        (x) => x,
        (y) => y + 10,
      ),
    ),
  ),
})
