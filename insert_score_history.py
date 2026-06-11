"""Insert getScoreHistory procedure into the claims router in routers.ts."""
with open("server/routers.ts", "r") as f:
    lines = f.readlines()

# Find line 614 (0-indexed: 613) which is "      }),"
# We want to insert BEFORE line 615 (0-indexed: 614) which is "  }),"
# That means we insert after line 614 (0-indexed: 613)

insert_after = 613  # 0-indexed line number (line 614 in 1-indexed)

new_lines = [
    "\n",
    "    // --- Score History (Phase 108) ---\n",
    "    getScoreHistory: publicProcedure\n",
    "      .input(z.object({ claimId: z.number(), limit: z.number().min(1).max(100).default(30) }))\n",
    "      .query(async ({ input }) => {\n",
    "        const { getClaimScoreHistory } = await import('./db');\n",
    "        return getClaimScoreHistory(input.claimId, input.limit);\n",
    "      }),\n",
]

result = lines[:insert_after + 1] + new_lines + lines[insert_after + 1:]

with open("server/routers.ts", "w") as f:
    f.writelines(result)

print(f"Inserted {len(new_lines)} lines after line {insert_after + 1}")
print("Context around insertion:")
for i, l in enumerate(result[insert_after - 1:insert_after + len(new_lines) + 3]):
    print(f"  {insert_after + i}: {l}", end="")
