-- =============================================
-- INTERNAL NOTIFICATION SYSTEM - SQL SERVER
-- Updated Database Design with Industry Best Practices
-- =============================================


-- =============================================
-- 1. DEPARTMENTS TABLE
-- =============================================
CREATE TABLE notif_departments (
    department_id INT IDENTITY(1,1) PRIMARY KEY,
    department_code VARCHAR(20) NOT NULL UNIQUE,
    department_name NVARCHAR(100) NOT NULL UNIQUE,
    description NVARCHAR(500) NULL,
    is_active BIT DEFAULT 1,
    created_at DATETIME2 DEFAULT GETDATE(),
    updated_at DATETIME2 DEFAULT GETDATE(),
    created_by INT NULL
);


-- =============================================
-- 2. SUB-DEPARTMENTS TABLE
-- =============================================
CREATE TABLE notif_sub_departments (
    sub_department_id INT IDENTITY(1,1) PRIMARY KEY,
    department_id INT NOT NULL,
    sub_department_name NVARCHAR(100) NOT NULL,
    description NVARCHAR(500) NULL,
    is_active BIT DEFAULT 1,
    created_at DATETIME2 DEFAULT GETDATE(),
    updated_at DATETIME2 DEFAULT GETDATE(),
    created_by INT NULL,
    
    CONSTRAINT FK_notif_sub_departments_department 
        FOREIGN KEY (department_id) 
        REFERENCES notif_departments(department_id) 
        ON DELETE CASCADE,
    
    CONSTRAINT UQ_notif_sub_department_name 
        UNIQUE (department_id, sub_department_name)
);


-- =============================================
-- 3. USERS TABLE
-- =============================================
CREATE TABLE notif_users (
    user_id INT IDENTITY(1,1) PRIMARY KEY,
    first_name NVARCHAR(50) NOT NULL,
    last_name NVARCHAR(50) NOT NULL,
    email NVARCHAR(255) NOT NULL UNIQUE,
    password_hash NVARCHAR(255) NOT NULL,
    department_id INT NOT NULL,
    sub_department_id INT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('super-admin', 'admin', 'user')),
    phone_number VARCHAR(20) NULL,
    is_active BIT DEFAULT 1,
    last_login DATETIME2 NULL,
    created_at DATETIME2 DEFAULT GETDATE(),
    updated_at DATETIME2 DEFAULT GETDATE(),
    
    CONSTRAINT FK_notif_users_department 
        FOREIGN KEY (department_id) 
        REFERENCES notif_departments(department_id),
    
    CONSTRAINT FK_notif_users_sub_department 
        FOREIGN KEY (sub_department_id) 
        REFERENCES notif_sub_departments(sub_department_id)
);


-- =============================================
-- 4. NOTIFICATION CHANNELS TABLE (NEW)
-- =============================================
CREATE TABLE notif_notification_channels (
    channel_id INT IDENTITY(1,1) PRIMARY KEY,
    channel_name VARCHAR(20) NOT NULL UNIQUE,
    is_active BIT DEFAULT 1,
    created_at DATETIME2 DEFAULT GETDATE()
);

-- Insert default channels (FIXED TABLE NAME)
INSERT INTO notif_notification_channels (channel_name) VALUES ('email'), ('in_app'), ('sms');


-- =============================================
-- 5. NOTIFICATION TEMPLATES TABLE
-- =============================================
CREATE TABLE notif_notification_templates (
    template_id INT IDENTITY(1,1) PRIMARY KEY,
    template_name NVARCHAR(100) NOT NULL,
    department_id INT NOT NULL,
    subject NVARCHAR(200) NOT NULL,
    body NVARCHAR(MAX) NOT NULL,
    template_variables NVARCHAR(1000) NULL,
    is_active BIT DEFAULT 1,
    created_by INT NOT NULL,
    created_at DATETIME2 DEFAULT GETDATE(),
    updated_at DATETIME2 DEFAULT GETDATE(),
    
    CONSTRAINT FK_notif_templates_department 
        FOREIGN KEY (department_id) 
        REFERENCES notif_departments(department_id),
    
    CONSTRAINT FK_notif_templates_creator 
        FOREIGN KEY (created_by) 
        REFERENCES notif_users(user_id)
);


-- =============================================
-- 6. TEMPLATE CHANNELS TABLE (NEW - Junction Table)
-- =============================================
CREATE TABLE notif_template_channels (
    template_id INT NOT NULL,
    channel_id INT NOT NULL,
    created_at DATETIME2 DEFAULT GETDATE(),
    
    PRIMARY KEY (template_id, channel_id),
    
    CONSTRAINT FK_notif_template_channels_template 
        FOREIGN KEY (template_id) 
        REFERENCES notif_notification_templates(template_id) 
        ON DELETE CASCADE,
    
    CONSTRAINT FK_notif_template_channels_channel 
        FOREIGN KEY (channel_id) 
        REFERENCES notif_notification_channels(channel_id)
);


-- =============================================
-- 7. NOTIFICATION SCHEDULES TABLE (UPDATED)
-- =============================================
CREATE TABLE notif_notification_schedules (
    schedule_id INT IDENTITY(1,1) PRIMARY KEY,
    template_id INT NOT NULL,
    department_id INT NOT NULL,
    sub_department_id INT NULL,
    schedule_type VARCHAR(20) NOT NULL CHECK (
        schedule_type IN ('once', 'daily', 'weekly', 'monthly')
    ),
    schedule_time TIME NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NULL,
    template_variables NVARCHAR(2000) NULL,
    is_active BIT DEFAULT 1,
    last_executed DATETIME2 NULL,
    next_execution DATETIME2 NULL,
    created_by INT NOT NULL,
    created_at DATETIME2 DEFAULT GETDATE(),
    updated_at DATETIME2 DEFAULT GETDATE(),
    
    CONSTRAINT FK_notif_schedules_template 
        FOREIGN KEY (template_id) 
        REFERENCES notif_notification_templates(template_id),
    
    CONSTRAINT FK_notif_schedules_department 
        FOREIGN KEY (department_id) 
        REFERENCES notif_departments(department_id),
    
    CONSTRAINT FK_notif_schedules_sub_department 
        FOREIGN KEY (sub_department_id) 
        REFERENCES notif_sub_departments(sub_department_id),
    
    CONSTRAINT FK_notif_schedules_creator 
        FOREIGN KEY (created_by) 
        REFERENCES notif_users(user_id)
);


-- =============================================
-- 8. SCHEDULE RECIPIENTS TABLE (NEW - Junction Table)
-- =============================================
CREATE TABLE notif_schedule_recipients (
    id INT IDENTITY(1,1) PRIMARY KEY,
    schedule_id INT NOT NULL,
    user_id INT NOT NULL,
    created_at DATETIME2 DEFAULT GETDATE(),
    
    CONSTRAINT FK_notif_schedule_recipients_schedule 
        FOREIGN KEY (schedule_id) 
        REFERENCES notif_notification_schedules(schedule_id) 
        ON DELETE CASCADE,
    
    CONSTRAINT FK_notif_schedule_recipients_user 
        FOREIGN KEY (user_id) 
        REFERENCES notif_users(user_id),
    
    CONSTRAINT UQ_notif_schedule_recipient 
        UNIQUE (schedule_id, user_id)
);


-- =============================================
-- 9. NOTIFICATIONS TABLE
-- =============================================
CREATE TABLE notif_notifications (
    notification_id BIGINT IDENTITY(1,1) PRIMARY KEY,
    template_id INT NULL,
    schedule_id INT NULL,
    user_id INT NOT NULL,
    department_id INT NOT NULL,
    sub_department_id INT NULL,
    subject NVARCHAR(200) NOT NULL,
    body NVARCHAR(MAX) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'sent', 'failed', 'read')
    ),
    metadata NVARCHAR(1000) NULL,
    sent_at DATETIME2 NULL,
    read_at DATETIME2 NULL,
    created_at DATETIME2 DEFAULT GETDATE(),
    
    CONSTRAINT FK_notif_notifications_template 
        FOREIGN KEY (template_id) 
        REFERENCES notif_notification_templates(template_id),
    
    CONSTRAINT FK_notif_notifications_schedule 
        FOREIGN KEY (schedule_id) 
        REFERENCES notif_notification_schedules(schedule_id),
    
    CONSTRAINT FK_notif_notifications_user 
        FOREIGN KEY (user_id) 
        REFERENCES notif_users(user_id),
    
    CONSTRAINT FK_notif_notifications_department 
        FOREIGN KEY (department_id) 
        REFERENCES notif_departments(department_id)
);


-- =============================================
-- 10. NOTIFICATION DELIVERY LOG TABLE
-- =============================================
CREATE TABLE notif_notification_delivery_log (
    log_id BIGINT IDENTITY(1,1) PRIMARY KEY,
    notification_id BIGINT NOT NULL,
    channel_id INT NOT NULL,
    delivery_status VARCHAR(20) NOT NULL CHECK (
        delivery_status IN ('pending', 'delivered', 'failed', 'bounced')
    ),
    error_message NVARCHAR(500) NULL,
    delivery_attempts INT DEFAULT 0,
    delivered_at DATETIME2 NULL,
    created_at DATETIME2 DEFAULT GETDATE(),
    
    CONSTRAINT FK_notif_delivery_log_notification 
        FOREIGN KEY (notification_id) 
        REFERENCES notif_notifications(notification_id) 
        ON DELETE CASCADE,
    
    CONSTRAINT FK_notif_delivery_log_channel 
        FOREIGN KEY (channel_id) 
        REFERENCES notif_notification_channels(channel_id)
);


-- =============================================
-- 11. USER NOTIFICATION PREFERENCES TABLE
-- =============================================
CREATE TABLE notif_user_notification_preferences (
    preference_id INT IDENTITY(1,1) PRIMARY KEY,
    user_id INT NOT NULL,
    channel_id INT NOT NULL,
    is_enabled BIT DEFAULT 1,
    quiet_hours_start TIME NULL,
    quiet_hours_end TIME NULL,
    timezone VARCHAR(50) DEFAULT 'Asia/Kolkata',
    created_at DATETIME2 DEFAULT GETDATE(),
    updated_at DATETIME2 DEFAULT GETDATE(),
    
    CONSTRAINT FK_notif_preferences_user 
        FOREIGN KEY (user_id) 
        REFERENCES notif_users(user_id) 
        ON DELETE CASCADE,
    
    CONSTRAINT FK_notif_preferences_channel 
        FOREIGN KEY (channel_id) 
        REFERENCES notif_notification_channels(channel_id),
    
    CONSTRAINT UQ_notif_user_channel 
        UNIQUE (user_id, channel_id)
);


-- =============================================
-- 12. AUDIT LOG TABLE
-- =============================================
CREATE TABLE notif_audit_logs (
    log_id BIGINT IDENTITY(1,1) PRIMARY KEY,
    table_name VARCHAR(100) NOT NULL,
    record_id INT NOT NULL,
    action VARCHAR(10) NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
    old_values NVARCHAR(MAX) NULL,
    new_values NVARCHAR(MAX) NULL,
    performed_by INT NULL,
    performed_at DATETIME2 DEFAULT GETDATE(),
    
    CONSTRAINT FK_notif_audit_user 
        FOREIGN KEY (performed_by) 
        REFERENCES notif_users(user_id)
);

