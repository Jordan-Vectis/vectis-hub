-- Admin-corrected AI prices (USD per 1,000,000 tokens) for the run cost
-- estimator. Only rows an admin has edited live here; everything else falls
-- back to the built-in table in lib/ai-pricing.ts.
CREATE TABLE IF NOT EXISTS "AiModelRate" (
    "modelId"    TEXT NOT NULL,
    "inputPerM"  DOUBLE PRECISION NOT NULL,
    "outputPerM" DOUBLE PRECISION NOT NULL,
    "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "AiModelRate_pkey" PRIMARY KEY ("modelId")
);
