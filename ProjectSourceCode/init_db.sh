#!/bin/bash

# DO NOT PUSH THIS FILE TO GITHUB
# This file contains sensitive information and should be kept private

# TODO: Set your PostgreSQL URI - Use the External Database URL from the Render dashboard
PG_URI="postgresql://postgres1:y0NReyww9H3c8yLuKeLwLOCkYRa1R7DE@dpg-d00j2r1r0fns73ebf860-a.oregon-postgres.render.com/user_db_1rgw"

# Execute each .sql file in the directory
for file in init_data/*.sql; do
    echo "Executing $file..."
    psql $PG_URI -f "$file"
done