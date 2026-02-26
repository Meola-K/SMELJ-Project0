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
    user_id INT NOT NULL,
    type ENUM('in','out') NOT NULL,
    stamp_time DATETIME NOT NULL,
    source ENUM('arduino','web','app') DEFAULT 'web',
    device_id VARCHAR(50) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_time (user_id, stamp_time)
);

CREATE TABLE requests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    type ENUM('urlaub','gleitzeit','homeoffice','krank') NOT NULL,
    date_from DATE NOT NULL,
    date_to DATE NOT NULL,
    note TEXT DEFAULT NULL,
    status ENUM('pending','approved','denied') DEFAULT 'pending',
    reviewed_by INT DEFAULT NULL,
    reviewed_at DATETIME DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_user_status (user_id, status)
);

CREATE TABLE devices (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    location VARCHAR(100) DEFAULT NULL,
    mode ENUM('stamp','assign') DEFAULT 'stamp',
    assign_user_id INT DEFAULT NULL,
    last_seen DATETIME DEFAULT NULL,
    active TINYINT(1) DEFAULT 1,
    FOREIGN KEY (assign_user_id) REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO groups_table (name) VALUES ('Allgemein'), ('Entwicklung'), ('Verwaltung');

INSERT INTO users (email, password, first_name, last_name, role, group_id)
VALUES ('admin@zeitstempel.de', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'System', 'Admin', 'admin', 3);
