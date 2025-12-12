/**
 * ========================================
 * SCHEDULE HELPER UTILITIES
 * ========================================
 */

/**
 * Check if schedule should execute today
 */
export function shouldExecuteToday(
    scheduleType: string,
    startDate: Date,
    lastExecuted: Date | null
  ): boolean {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
  
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
  
    // If never executed and start date is today or past
    if (!lastExecuted && start <= today) {
      return true;
    }
  
    // If already executed today, skip
    if (lastExecuted) {
      const lastExec = new Date(lastExecuted);
      lastExec.setHours(0, 0, 0, 0);
  
      if (lastExec.getTime() === today.getTime()) {
        return false; // Already executed today
      }
    }
  
    // Type-specific logic
    switch (scheduleType) {
      case "once":
        // Execute only once (if not executed yet)
        return !lastExecuted && start <= today;
  
      case "daily":
        // Execute every day
        return start <= today;
  
      case "weekly":
        // Execute every 7 days
        if (!lastExecuted) return start <= today;
        const daysSinceLastExec = Math.floor(
          (today.getTime() - new Date(lastExecuted).getTime()) / (1000 * 60 * 60 * 24)
        );
        return daysSinceLastExec >= 7;
  
      case "monthly":
        // Execute on same day of month
        if (!lastExecuted) return start <= today;
        const lastExecDate = new Date(lastExecuted);
        return (
          today.getMonth() !== lastExecDate.getMonth() ||
          today.getFullYear() !== lastExecDate.getFullYear()
        );
  
      default:
        return false;
    }
  }
  
  /**
   * Calculate next execution time
   */
  export function calculateNextExecution(
    scheduleType: string,
    startDate: Date,
    scheduleTime: string
  ): Date | null {
    const now = new Date();
    const [hours, minutes] = scheduleTime.split(":").map(Number);
  
    switch (scheduleType) {
      case "once":
        // One-time schedule, no next execution
        return null;
  
      case "daily":
        // Next execution: tomorrow at schedule_time
        const nextDaily = new Date(now);
        nextDaily.setDate(nextDaily.getDate() + 1);
        nextDaily.setHours(hours, minutes, 0, 0);
        return nextDaily;
  
      case "weekly":
        // Next execution: 7 days from now at schedule_time
        const nextWeekly = new Date(now);
        nextWeekly.setDate(nextWeekly.getDate() + 7);
        nextWeekly.setHours(hours, minutes, 0, 0);
        return nextWeekly;
  
      case "monthly":
        // Next execution: same day next month at schedule_time
        const nextMonthly = new Date(now);
        nextMonthly.setMonth(nextMonthly.getMonth() + 1);
        nextMonthly.setHours(hours, minutes, 0, 0);
        return nextMonthly;
  
      default:
        return null;
    }
  }
  
  /**
   * Replace template placeholders with actual values
   * Example: "Hello {{first_name}}" → "Hello John"
   */
  export function replaceTemplateVariables(
    template: string,
    variables: Record<string, any>
  ): string {
    let result = template;
  
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, "g");
      result = result.replace(regex, String(value));
    }
  
    return result;
  }
  