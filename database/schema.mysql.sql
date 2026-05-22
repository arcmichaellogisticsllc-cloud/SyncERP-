CREATE DATABASE IF NOT EXISTS syncerp
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE syncerp;

CREATE TABLE IF NOT EXISTS app_state (
  state_key VARCHAR(80) NOT NULL,
  payload JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (state_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS records (
  collection_name VARCHAR(80) NOT NULL,
  record_id VARCHAR(160) NOT NULL,
  project_id VARCHAR(160) NULL,
  status_value VARCHAR(160) NULL,
  owner_value VARCHAR(160) NULL,
  source_value VARCHAR(160) NULL,
  created_at_value DATETIME NULL,
  modified_at_value DATETIME NULL,
  payload JSON NOT NULL,
  imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (collection_name, record_id),
  KEY idx_records_collection (collection_name),
  KEY idx_records_project (project_id),
  KEY idx_records_status (status_value),
  KEY idx_records_owner (owner_value),
  KEY idx_records_modified (modified_at_value),
  CONSTRAINT chk_records_payload_json CHECK (JSON_VALID(payload))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_events (
  audit_id VARCHAR(160) NOT NULL,
  action_value VARCHAR(160) NULL,
  actor_value VARCHAR(160) NULL,
  project_id VARCHAR(160) NULL,
  event_at DATETIME NULL,
  payload JSON NOT NULL,
  imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (audit_id),
  KEY idx_audit_action (action_value),
  KEY idx_audit_actor (actor_value),
  KEY idx_audit_project (project_id),
  KEY idx_audit_event_at (event_at),
  CONSTRAINT chk_audit_payload_json CHECK (JSON_VALID(payload))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
