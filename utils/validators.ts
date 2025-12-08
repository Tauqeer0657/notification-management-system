// Simple validation helper
export const validateEmail = (email: string): boolean => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };
  
export const validatePassword = (password: string): boolean => {
    return password.length >= 8;
  };

export const validatePhone = (phone: string): boolean => {
    return /^\+?[\d\s\-()]+$/.test(phone) && phone.length >= 10;
  };