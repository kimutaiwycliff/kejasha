package ke.kejasha.app.ui.common

import ke.kejasha.api.models.BookingSource
import ke.kejasha.api.models.BookingStatus
import ke.kejasha.api.models.PaymentSuggestion
import ke.kejasha.api.models.TicketCategory
import ke.kejasha.api.models.TicketPriority
import ke.kejasha.api.models.TicketStatus

// Same wording as the web app (apps/web/lib/labels.ts).

val TicketStatus.label: String
    get() = when (this) {
        TicketStatus.OPEN -> "Open"
        TicketStatus.IN_PROGRESS -> "In progress"
        TicketStatus.RESOLVED -> "Resolved"
        TicketStatus.CLOSED -> "Closed"
        TicketStatus.CANCELLED -> "Cancelled"
    }

val TicketStatus.tone: Tone
    get() = when (this) {
        TicketStatus.OPEN -> Tone.WARN
        TicketStatus.IN_PROGRESS -> Tone.NEUTRAL
        TicketStatus.RESOLVED, TicketStatus.CLOSED -> Tone.GOOD
        TicketStatus.CANCELLED -> Tone.NEUTRAL
    }

val TicketPriority.label: String
    get() = when (this) {
        TicketPriority.LOW -> "Low"
        TicketPriority.NORMAL -> "Normal"
        TicketPriority.HIGH -> "High"
        TicketPriority.URGENT -> "Urgent"
    }

val TicketCategory.label: String
    get() = when (this) {
        TicketCategory.PLUMBING -> "Plumbing"
        TicketCategory.ELECTRICAL -> "Electrical"
        TicketCategory.STRUCTURAL -> "Structural"
        TicketCategory.APPLIANCE -> "Appliance"
        TicketCategory.PEST -> "Pests"
        TicketCategory.CLEANING -> "Cleaning"
        TicketCategory.SECURITY -> "Security"
        TicketCategory.OTHER -> "Other"
    }

val BookingStatus.label: String
    get() = when (this) {
        BookingStatus.CONFIRMED -> "Confirmed"
        BookingStatus.CHECKED_IN -> "Checked in"
        BookingStatus.CHECKED_OUT -> "Checked out"
        BookingStatus.CANCELLED -> "Cancelled"
        BookingStatus.NO_SHOW -> "No-show"
    }

val BookingSource.label: String
    get() = when (this) {
        BookingSource.DIRECT -> "Direct"
        BookingSource.WALK_IN -> "Walk-in"
        BookingSource.WHATSAPP -> "WhatsApp"
        BookingSource.AIRBNB -> "Airbnb"
        BookingSource.BOOKING -> "Booking.com"
        BookingSource.OTHER -> "Other"
    }

val PaymentSuggestion.Reasons.label: String
    get() = when (this) {
        PaymentSuggestion.Reasons.PHONE -> "same phone"
        PaymentSuggestion.Reasons.ACCOUNT_REF -> "account number"
        PaymentSuggestion.Reasons.EXACT_INVOICE_AMOUNT -> "matches an invoice"
        PaymentSuggestion.Reasons.EXACT_BALANCE -> "matches the balance"
        PaymentSuggestion.Reasons.NAME -> "similar name"
    }
