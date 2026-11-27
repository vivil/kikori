// Commit messages follow Conventional Commits with the types of the Angular convention:
// build, chore, ci, docs, feat, fix, perf, refactor, revert, style, test.
export default {
  extends: ["@commitlint/config-conventional"],
  // Dependabot writes its own message bodies, which contain long lines.
  ignores: [(message) => /^Signed-off-by: dependabot\[bot\]/m.test(message)],
};
