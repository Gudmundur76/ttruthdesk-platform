-- Sprint 8 — Phase 133 migration
-- Adds: pricing_leads table for /pricing page "Request Access" form submissions.
--
-- This table stores inbound leads from the pricing page.
-- Notifications are dispatched via Telegram or Forge email when a new lead arrives.
-- ─── pricing_leads ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `pricing_leads` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `name` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `organisation` varchar(255) NOT NULL,
  `tier` enum('starter','diligence','platform_pilot') NOT NULL,
  `useCase` text,
  `status` enum('new','contacted','converted','declined') NOT NULL DEFAULT 'new',
  `notifiedAt` int,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `pl_tier_idx` (`tier`),
  KEY `pl_status_idx` (`status`),
  KEY `pl_created_at_idx` (`createdAt`)
);
