CREATE TYPE "public"."ai_status" AS ENUM('PENDING', 'COMPLETED', 'FALLBACK');--> statement-breakpoint
CREATE TYPE "public"."alert_severity" AS ENUM('WARNING', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."alert_status" AS ENUM('ACTIVE', 'RESOLVED');--> statement-breakpoint
CREATE TYPE "public"."notification_reason" AS ENUM('NEW', 'ESCALATED');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('PENDING', 'SENDING', 'SENT', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."resolution_source" AS ENUM('MANUAL', 'AUTO');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('ADMIN', 'MANAGER');--> statement-breakpoint
CREATE TABLE "alert_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_id" uuid NOT NULL,
	"channel" varchar(16) DEFAULT 'email' NOT NULL,
	"reason" "notification_reason" NOT NULL,
	"status" "notification_status" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" varchar(500),
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_notifications_alert_channel_reason_uq" UNIQUE("alert_id","channel","reason")
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fingerprint" char(64) NOT NULL,
	"api_name" varchar(120) NOT NULL,
	"status" "alert_status" DEFAULT 'ACTIVE' NOT NULL,
	"severity" "alert_severity" NOT NULL,
	"previous_severity" "alert_severity",
	"anomaly_types" text[] NOT NULL,
	"status_code" integer,
	"response_time_ms" integer,
	"records_returned" integer,
	"last_status_code" integer,
	"last_response_time_ms" integer,
	"last_records_returned" integer,
	"peak_response_time_ms" integer,
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"alert_message" text NOT NULL,
	"probable_cause" text NOT NULL,
	"recommended_action" text NOT NULL,
	"ai_status" "ai_status" DEFAULT 'PENDING' NOT NULL,
	"ai_provider" varchar(16),
	"ai_model" varchar(100),
	"ai_prompt_version" varchar(32),
	"ai_generated_at" timestamp with time zone,
	"enrichment_version" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"escalated_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolution_source" "resolution_source",
	"resolution_note" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_type" varchar(16) NOT NULL,
	"actor_id" uuid,
	"action" varchar(64) NOT NULL,
	"target_type" varchar(32),
	"target_id" varchar(128),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" "inet",
	"request_id" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitor_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" varchar(24) NOT NULL,
	"source_detail" varchar(200),
	"principal" varchar(80) NOT NULL,
	"received" integer DEFAULT 0 NOT NULL,
	"processed" integer DEFAULT 0 NOT NULL,
	"healthy" integer DEFAULT 0 NOT NULL,
	"anomalous" integer DEFAULT 0 NOT NULL,
	"rejected" integer DEFAULT 0 NOT NULL,
	"alerts_created" integer DEFAULT 0 NOT NULL,
	"alerts_updated" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"request_id" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitored_apis" (
	"name" varchar(120) PRIMARY KEY NOT NULL,
	"latency_warning_ms" integer,
	"latency_critical_ms" integer,
	"expects_records" boolean DEFAULT true NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monitored_apis_thresholds_check" CHECK (("monitored_apis"."latency_warning_ms" IS NULL AND "monitored_apis"."latency_critical_ms" IS NULL) OR ("monitored_apis"."latency_warning_ms" IS NOT NULL AND "monitored_apis"."latency_critical_ms" IS NOT NULL AND "monitored_apis"."latency_critical_ms" > "monitored_apis"."latency_warning_ms"))
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"token_hash" char(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" varchar(32),
	"replaced_by_id" uuid,
	"created_ip" "inet",
	"user_agent" varchar(256),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "rejected_telemetry" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rejected_telemetry_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"run_id" uuid NOT NULL,
	"item_index" integer NOT NULL,
	"reason" varchar(32) NOT NULL,
	"field_errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telemetry_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "telemetry_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"run_id" uuid NOT NULL,
	"api_name" varchar(120) NOT NULL,
	"status_code" integer,
	"response_time_ms" integer,
	"records_returned" integer,
	"is_anomalous" boolean NOT NULL,
	"severity" "alert_severity",
	"anomaly_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"alert_id" uuid,
	"observed_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(254) NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"token_version" integer DEFAULT 0 NOT NULL,
	"last_login_at" timestamp with time zone,
	"password_changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "alert_notifications" ADD CONSTRAINT "alert_notifications_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rejected_telemetry" ADD CONSTRAINT "rejected_telemetry_run_id_monitor_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."monitor_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_logs" ADD CONSTRAINT "telemetry_logs_run_id_monitor_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."monitor_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_logs" ADD CONSTRAINT "telemetry_logs_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_notifications_status_created_at_idx" ON "alert_notifications" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_active_fingerprint_uq" ON "alerts" USING btree ("fingerprint") WHERE status = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "alerts_status_severity_last_seen_idx" ON "alerts" USING btree ("status","severity","last_seen_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "alerts_api_name_status_idx" ON "alerts" USING btree ("api_name","status");--> statement-breakpoint
CREATE INDEX "alerts_pending_updated_at_idx" ON "alerts" USING btree ("updated_at") WHERE ai_status = 'PENDING';--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "monitor_runs_created_at_idx" ON "monitor_runs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "rejected_telemetry_received_at_idx" ON "rejected_telemetry" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "rejected_telemetry_run_id_idx" ON "rejected_telemetry" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "telemetry_logs_api_name_observed_at_idx" ON "telemetry_logs" USING btree ("api_name","observed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "telemetry_logs_observed_at_idx" ON "telemetry_logs" USING btree ("observed_at");--> statement-breakpoint
CREATE INDEX "telemetry_logs_alert_id_idx" ON "telemetry_logs" USING btree ("alert_id");--> statement-breakpoint
CREATE INDEX "telemetry_logs_run_id_idx" ON "telemetry_logs" USING btree ("run_id");