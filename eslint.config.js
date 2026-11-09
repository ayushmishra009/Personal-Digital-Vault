import tseslint from "typescript-eslint";

export default tseslint.config(...tseslint.configs.recommended, {
  ignores: ["**/dist/**", "**/.turbo/**", "**/.wxt/**", "**/.output/**"],
});
