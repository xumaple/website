use dashmap::DashMap;
use std::net::IpAddr;
use std::time::{Duration, Instant};

/// In-memory per-IP rate limiter using a sliding window.
pub struct RateLimiter {
    /// Map of IP addresses to their request timestamps within the current window.
    requests: DashMap<IpAddr, Vec<Instant>>,
    max_requests: u32,
    window: Duration,
}

impl RateLimiter {
    pub fn new(max_requests: u32, window: Duration) -> Self {
        Self {
            requests: DashMap::new(),
            max_requests,
            window,
        }
    }

    /// Returns `true` if the request is allowed, `false` if rate limit exceeded.
    pub fn check(&self, ip: IpAddr) -> bool {
        let now = Instant::now();
        let mut entry = self.requests.entry(ip).or_default();
        entry.retain(|t| now.duration_since(*t) < self.window);
        if entry.len() >= self.max_requests as usize {
            false
        } else {
            entry.push(now);
            true
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    #[test]
    fn test_allows_requests_under_limit() {
        let limiter = RateLimiter::new(5, Duration::from_secs(60));
        let ip = IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1));

        for _ in 0..5 {
            assert!(limiter.check(ip));
        }
    }

    #[test]
    fn test_blocks_requests_over_limit() {
        let limiter = RateLimiter::new(3, Duration::from_secs(60));
        let ip = IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1));

        assert!(limiter.check(ip));
        assert!(limiter.check(ip));
        assert!(limiter.check(ip));
        assert!(!limiter.check(ip)); // 4th request blocked
    }

    #[test]
    fn test_different_ips_independent() {
        let limiter = RateLimiter::new(2, Duration::from_secs(60));
        let ip1 = IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1));
        let ip2 = IpAddr::V4(Ipv4Addr::new(10, 0, 0, 2));

        assert!(limiter.check(ip1));
        assert!(limiter.check(ip1));
        assert!(!limiter.check(ip1)); // ip1 blocked

        assert!(limiter.check(ip2)); // ip2 still allowed
        assert!(limiter.check(ip2));
        assert!(!limiter.check(ip2)); // ip2 now blocked
    }

    #[test]
    fn test_window_expiry() {
        let limiter = RateLimiter::new(2, Duration::from_millis(50));
        let ip = IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1));

        assert!(limiter.check(ip));
        assert!(limiter.check(ip));
        assert!(!limiter.check(ip)); // blocked

        std::thread::sleep(Duration::from_millis(60));

        assert!(limiter.check(ip)); // allowed again after window expires
    }
}
