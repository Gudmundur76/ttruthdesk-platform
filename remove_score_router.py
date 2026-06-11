"""Remove the standalone scoreHistory top-level router (now merged into claims router)."""
with open("server/routers.ts", "r") as f:
    content = f.read()

# The standalone router block to remove
old = """  // ─── Claim Score History ─────────────────────────────────────────────────────
  scoreHistory: router({
    getByClaim: publicProcedure
      .input(z.object({ claimId: z.number(), limit: z.number().min(1).max(100).default(30) }))
      .query(async ({ input }) => {
        const { getClaimScoreHistory } = await import("./db");
        return getClaimScoreHistory(input.claimId, input.limit);
      }),
  }),
  // ─── SIA Harness Improvement Loop ────────────────────────────────────────────"""

new = """  // ─── SIA Harness Improvement Loop ────────────────────────────────────────────"""

if old in content:
    content = content.replace(old, new)
    with open("server/routers.ts", "w") as f:
        f.write(content)
    print("Removed standalone scoreHistory router")
else:
    # Try to find it with different dash characters
    import re
    # Find the block using line numbers
    lines = content.split('\n')
    start = None
    for i, line in enumerate(lines):
        if 'scoreHistory: router({' in line and i > 4900:
            start = i - 1  # include the comment line before
            break
    if start is not None:
        # Find the closing
        end = None
        for i in range(start + 1, min(start + 15, len(lines))):
            if lines[i].strip() == '}),':
                end = i
                break
        if end is not None:
            print(f"Found block at lines {start+1}-{end+1}")
            print("Block to remove:")
            for l in lines[start:end+1]:
                print(f"  {l}")
            del lines[start:end+1]
            with open("server/routers.ts", "w") as f:
                f.write('\n'.join(lines))
            print("Removed standalone scoreHistory router via line deletion")
        else:
            print("ERROR: Could not find closing brace")
    else:
        print("ERROR: Could not find scoreHistory router block")
