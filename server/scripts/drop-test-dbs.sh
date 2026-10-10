#!/bin/sh
# Testlerin açtığı geçici veritabanlarını siler (her test kendi veritabanını açar).
for db in $(psql -d postgres -Atc "select datname from pg_database where datname like 'retfast_test_%'"); do
  dropdb "$db" && echo "dropped $db"
done
