UPDATE "responsible_students" SET "relationship_type" = 'parent'
  WHERE "relationship_type" IN ('father', 'mother');--> statement-breakpoint
UPDATE "responsible_students" SET "relationship_type" = 'grandparent'
  WHERE "relationship_type" IN ('grandfather', 'grandmother');--> statement-breakpoint
UPDATE "responsible_invitation_students" SET "relationship_type" = 'parent'
  WHERE "relationship_type" IN ('father', 'mother');--> statement-breakpoint
UPDATE "responsible_invitation_students" SET "relationship_type" = 'grandparent'
  WHERE "relationship_type" IN ('grandfather', 'grandmother');
