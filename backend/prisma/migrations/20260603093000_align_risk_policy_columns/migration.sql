DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'risk_policies' AND column_name = 'riskLevel'
  ) THEN
    ALTER TABLE "risk_policies" RENAME COLUMN "riskLevel" TO "risk_level";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'risk_policies' AND column_name = 'requireConfirm'
  ) THEN
    ALTER TABLE "risk_policies" RENAME COLUMN "requireConfirm" TO "require_confirm";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'risk_policies' AND column_name = 'autoExecute'
  ) THEN
    ALTER TABLE "risk_policies" RENAME COLUMN "autoExecute" TO "auto_execute";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'risk_policies' AND column_name = 'minPlan'
  ) THEN
    ALTER TABLE "risk_policies" RENAME COLUMN "minPlan" TO "min_plan";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'risk_policies' AND column_name = 'allowedRoles'
  ) THEN
    ALTER TABLE "risk_policies" RENAME COLUMN "allowedRoles" TO "allowed_roles";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'risk_policies' AND column_name = 'createdAt'
  ) THEN
    ALTER TABLE "risk_policies" RENAME COLUMN "createdAt" TO "created_at";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'risk_policies' AND column_name = 'updatedAt'
  ) THEN
    ALTER TABLE "risk_policies" RENAME COLUMN "updatedAt" TO "updated_at";
  END IF;
END $$;
