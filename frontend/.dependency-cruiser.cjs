/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Prevent runtime circular dependencies across frontend modules (type-only imports excluded).",
      from: {},
      to: {
        circular: true,
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "no-types-outgoing",
      severity: "error",
      comment: "src/types must remain a leaf layer with no outgoing runtime dependencies.",
      from: {
        path: "^src/types/",
      },
      to: {
        path: "^src/",
        pathNot: "^src/types/",
      },
    },
    {
      name: "no-api-upward",
      severity: "error",
      comment: "src/api may depend only on src/api and src/types.",
      from: {
        path: "^src/api/",
      },
      to: {
        path: "^src/(components|hooks|providers|local|utils|App\\.tsx|main\\.tsx)",
      },
    },
    {
      name: "no-utils-local-upward",
      severity: "error",
      comment: "src/utils and src/local may depend only on types and sibling utilities.",
      from: {
        path: "^src/(utils|local)/",
      },
      to: {
        path: "^src/(api|components|hooks|providers|App\\.tsx|main\\.tsx)",
      },
    },
    {
      name: "no-providers-to-ui",
      severity: "error",
      comment: "src/providers must not import UI components or hooks.",
      from: {
        path: "^src/providers/",
      },
      to: {
        path: "^src/(components|hooks|App\\.tsx|main\\.tsx)",
      },
    },
    {
      name: "no-hooks-to-components",
      severity: "error",
      comment: "src/hooks must not depend on React components (shared types belong in src/types).",
      from: {
        path: "^src/hooks/",
      },
      to: {
        path: "^src/components/",
      },
    },
    {
      name: "no-imports-from-app-or-main",
      severity: "error",
      comment: "Only src/main.tsx may import App.tsx; nothing may import main.tsx.",
      from: {
        path: "^src/",
        pathNot: "^src/main\\.tsx$",
      },
      to: {
        path: "^src/(App|main)\\.tsx$",
      },
    },
  ],
  options: {
    doNotFollow: {
      path: ["node_modules"],
    },
    exclude: {
      path: ["\\.test\\.(ts|tsx)$", "^src/test/"],
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: "tsconfig.json",
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      mainFields: ["module", "main", "types", "typings"],
    },
    reporterOptions: {
      text: {
        highlightFocused: true,
      },
    },
  },
};
