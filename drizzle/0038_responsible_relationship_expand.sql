ALTER TYPE "public"."responsible_relationship_type" ADD VALUE IF NOT EXISTS 'parent';--> statement-breakpoint
ALTER TYPE "public"."responsible_relationship_type" ADD VALUE IF NOT EXISTS 'grandparent';--> statement-breakpoint
ALTER TYPE "public"."responsible_relationship_type" ADD VALUE IF NOT EXISTS 'aunt_uncle';--> statement-breakpoint
ALTER TYPE "public"."responsible_relationship_type" ADD VALUE IF NOT EXISTS 'sibling';--> statement-breakpoint
ALTER TYPE "public"."responsible_relationship_type" ADD VALUE IF NOT EXISTS 'godparent';
