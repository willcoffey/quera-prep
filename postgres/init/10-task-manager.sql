\getenv pw TASK_MANAGER_DB_PASSWORD
CREATE ROLE task_manager LOGIN PASSWORD :'pw';
CREATE DATABASE task_manager OWNER task_manager;
