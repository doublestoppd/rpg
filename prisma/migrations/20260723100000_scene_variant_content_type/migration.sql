-- Make scene variants a first-class versioned content type.
ALTER TYPE "ContentType" ADD VALUE IF NOT EXISTS 'SCENE_VARIANT';
