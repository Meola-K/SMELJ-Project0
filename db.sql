CREATE DATABASE IF NOT EXISTS zeitstempel CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE zeitstempel;

CREATE TABLE groups_table (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    role ENUM('admin','vorgesetzter','arbeiter') DEFAULT 'arbeiter',
    supervisor_id INT DEFAULT NULL,
    group_id INT DEFAULT NULL,
    nfc_uid VARCHAR(50) DEFAULT NULL,
    active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (supervisor_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (group_id) REFERENCES groups_table(id) ON DELETE SET NULL
);

CREATE TABLE work_rules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    weekday TINYINT NOT NULL,
    core_start TIME DEFAULT NULL,
    core_end TIME DEFAULT NULL,
    max_daily_minutes INT DEFAULT 480,
    work_allowed TINYINT(1) DEFAULT 1,
    UNIQUE KEY unique_user_day (user_id, weekday),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE time_limits (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    max_weekly_minutes INT DEFAULT 2400,
    max_overtime_minutes INT DEFAULT 720,
    max_undertime_minutes INT DEFAULT 240,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE timestamps_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT DEFAULT NULL,
    type ENUM('in','out') NOT NULL,
    stamp_time DATETIME NOT NULL,
    source ENUM('arduino','web','app') DEFAULT 'web',
    device_id VARCHAR(50) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_user_time (user_id, stamp_time)
);

CREATE TABLE requests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT DEFAULT NULL,
    type ENUM('urlaub','gleitzeit','homeoffice','krank','sonderurlaub') NOT NULL,
    date_from DATE NOT NULL,
    date_to DATE NOT NULL,
    note TEXT DEFAULT NULL,
    -- Anlass nur bei type='sonderurlaub' relevant; bei 'sonstiges' MUSS note gefüllt sein (Freitext)
    reason ENUM('hochzeit','geburt','trauerfall','umzug','sonstiges') DEFAULT NULL,
    -- SCRUM-292: 4-Augen-Prinzip. pending -> first_approved -> approved; Ablehnung jederzeit -> denied.
    status ENUM('pending','first_approved','approved','denied') DEFAULT 'pending',
    first_reviewed_by INT DEFAULT NULL,
    first_reviewed_at DATETIME DEFAULT NULL,
    reviewed_by INT DEFAULT NULL,
    reviewed_at DATETIME DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (first_reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_user_status (user_id, status)
);

-- Migration für bestehende Datenbanken (separat ausführen, falls die Tabelle schon existiert):
-- ALTER TABLE requests
--   MODIFY COLUMN type ENUM('urlaub','gleitzeit','homeoffice','krank','sonderurlaub') NOT NULL,
--   ADD COLUMN reason ENUM('hochzeit','geburt','trauerfall','umzug','sonstiges') DEFAULT NULL AFTER note;
-- SCRUM-304: 4-Augen-Migration siehe migrations/scrum292_4augen.sql

CREATE TABLE devices (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    location VARCHAR(100) DEFAULT NULL,
    mode ENUM('stamp','assign','frontdesk') DEFAULT 'stamp',
    assign_user_id INT DEFAULT NULL,
    last_seen DATETIME DEFAULT NULL,
    active TINYINT(1) DEFAULT 1,
    FOREIGN KEY (assign_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Migration für bestehende Datenbanken (SCRUM-294, separat ausführen):
-- ALTER TABLE devices MODIFY COLUMN mode ENUM('stamp','assign','frontdesk') DEFAULT 'stamp';

CREATE TABLE vacation_entitlements (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT DEFAULT NULL,
    year INT NOT NULL,
    total_days INT NOT NULL DEFAULT 30,
    UNIQUE KEY unique_user_year (user_id, year),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE corrections (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT DEFAULT NULL,
    stamp_id INT DEFAULT NULL,
    type ENUM('add','edit','delete') NOT NULL,
    original_time DATETIME DEFAULT NULL,
    corrected_time DATETIME DEFAULT NULL,
    stamp_type ENUM('in','out') DEFAULT NULL,
    reason TEXT NOT NULL,
    status ENUM('pending','approved','denied') DEFAULT 'pending',
    reviewed_by INT DEFAULT NULL,
    reviewed_at DATETIME DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (stamp_id) REFERENCES timestamps_log(id) ON DELETE SET NULL,
    FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_corr_status (user_id, status)
);

-- SCRUM-346/349: Schichtplan
CREATE TABLE shifts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(100) DEFAULT NULL,
    shift_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    group_id INT DEFAULT NULL,
    min_staff INT NOT NULL DEFAULT 1,
    created_by INT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES groups_table(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_shift_date (shift_date)
);

CREATE TABLE shift_assignments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    shift_id INT NOT NULL,
    user_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_shift_user (shift_id, user_id),
    FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_assign_user (user_id)
);

CREATE TABLE shift_swaps (
    id INT AUTO_INCREMENT PRIMARY KEY,
    assignment_id INT NOT NULL,
    from_user_id INT NOT NULL,
    to_user_id INT NOT NULL,
    status ENUM('pending','accepted','approved','denied','rejected','cancelled') DEFAULT 'pending',
    reviewed_by INT DEFAULT NULL,
    reviewed_at DATETIME DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (assignment_id) REFERENCES shift_assignments(id) ON DELETE CASCADE,
    FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_swap_status (status),
    INDEX idx_swap_to (to_user_id, status)
);

INSERT INTO groups_table (name) VALUES ('Allgemein'), ('Entwicklung'), ('Verwaltung');

INSERT INTO users (email, password, first_name, last_name, role, group_id)
VALUES ('admin@zeitstempel.de', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'System', 'Admin', 'admin', 3);

INSERT INTO vacation_entitlements (user_id, year, total_days) VALUES (1, 2026, 30);
