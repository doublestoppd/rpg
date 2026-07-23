-- World-map coordinates for each location (unitless canvas space). Existing
-- rows default to (0,0); the seed sets the real hand-placed positions.
ALTER TABLE "Location" ADD COLUMN "mapX" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Location" ADD COLUMN "mapY" INTEGER NOT NULL DEFAULT 0;
