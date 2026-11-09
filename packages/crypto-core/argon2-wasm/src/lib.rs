//! Experimental browser-WASM adapter for the PDV Argon2id provider boundary.
//!
//! Candidate only: not security-reviewed or approved for real vault data.

#![deny(unsafe_op_in_unsafe_fn)]

use argon2::{Algorithm, Argon2, Params, Version};

const PASSWORD_LIMIT: usize = 1024 * 1024;
const SALT_BYTES: usize = 16;
const OUTPUT_BYTES: usize = 32;
const MEMORY_KIB: u32 = 65_536;
const ITERATIONS: u32 = 3;
const LEGACY_PARALLELISM: u32 = 1;
const CURRENT_PARALLELISM: u32 = 4;

/// Allocate a byte buffer for the JavaScript/WASM bridge. Returns zero on
/// invalid size or allocation failure.
#[unsafe(no_mangle)]
pub extern "C" fn pdv_alloc(length: u32) -> u32 {
    if length == 0 || length as usize > PASSWORD_LIMIT.max(MEMORY_KIB as usize) {
        return 0;
    }
    let mut buffer = Vec::<u8>::new();
    if buffer.try_reserve_exact(length as usize).is_err() {
        return 0;
    }
    buffer.resize(length as usize, 0);
    let boxed = buffer.into_boxed_slice();
    let pointer = Box::into_raw(boxed) as *mut u8;
    pointer as usize as u32
}

/// Clear and free a buffer previously allocated by `pdv_alloc`.
/// The bridge must pass the original pointer and length exactly once.
///
/// # Safety
/// `pointer` must be a live allocation returned by `pdv_alloc`, and `length`
/// must be exactly the length used for that allocation. It must not be freed
/// more than once or while any other reference to its bytes is in use.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn pdv_free(pointer: u32, length: u32) {
    if pointer == 0
        || length == 0
        || length as usize > PASSWORD_LIMIT.max(MEMORY_KIB as usize)
        || !range_is_valid(pointer, length, wasm_memory_bytes())
    {
        return;
    }
    let raw_slice =
        core::ptr::slice_from_raw_parts_mut(pointer as usize as *mut u8, length as usize);
    let mut boxed = unsafe { Box::from_raw(raw_slice) };
    boxed.fill(0);
    drop(boxed);
}

/// Derive the legacy PDV v1 p=1 key. Retained for existing envelopes.
/// Returns 0 on success, 1 for invalid arguments, and 2 for KDF failure.
///
/// # Safety
/// Non-null pointers must refer to live WASM linear-memory allocations of at
/// least the specified lengths, with no overlapping mutable output region.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn pdv_derive_key(
    password_pointer: u32,
    password_length: u32,
    salt_pointer: u32,
    salt_length: u32,
    output_pointer: u32,
    output_length: u32,
) -> i32 {
    unsafe {
        derive_with_parameters(
            password_pointer,
            password_length,
            salt_pointer,
            salt_length,
            output_pointer,
            output_length,
            MEMORY_KIB,
            ITERATIONS,
            LEGACY_PARALLELISM,
            SALT_BYTES,
        )
    }
}

/// Derive the proposed PDV v1 p=4 key using its fixed tuple.
/// Returns 0 on success, 1 for invalid arguments, and 2 for KDF failure.
///
/// # Safety
/// Non-null pointers must refer to live WASM linear-memory allocations of at
/// least the specified lengths, with no overlapping input/output regions.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn pdv_derive_key_p4(
    password_pointer: u32,
    password_length: u32,
    salt_pointer: u32,
    salt_length: u32,
    output_pointer: u32,
    output_length: u32,
) -> i32 {
    unsafe {
        derive_with_parameters(
            password_pointer,
            password_length,
            salt_pointer,
            salt_length,
            output_pointer,
            output_length,
            MEMORY_KIB,
            ITERATIONS,
            CURRENT_PARALLELISM,
            SALT_BYTES,
        )
    }
}

/// Test-only export for a low-memory RustCrypto Argon2id v1.3 KAT.
///
/// # Safety
/// Non-null pointers must refer to live WASM linear-memory allocations of at
/// least the specified lengths, with no overlapping mutable output region.
#[cfg(feature = "test-vectors")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn pdv_test_kat(
    password_pointer: u32,
    password_length: u32,
    salt_pointer: u32,
    salt_length: u32,
    output_pointer: u32,
    output_length: u32,
) -> i32 {
    unsafe {
        derive_with_parameters(
            password_pointer,
            password_length,
            salt_pointer,
            salt_length,
            output_pointer,
            output_length,
            256,
            2,
            1,
            8,
        )
    }
}

unsafe fn derive_with_parameters(
    password_pointer: u32,
    password_length: u32,
    salt_pointer: u32,
    salt_length: u32,
    output_pointer: u32,
    output_length: u32,
    memory_kib: u32,
    iterations: u32,
    parallelism: u32,
    required_salt_length: usize,
) -> i32 {
    if password_pointer == 0
        || password_length as usize > PASSWORD_LIMIT
        || salt_pointer == 0
        || salt_length as usize != required_salt_length
        || output_pointer == 0
        || output_length as usize != OUTPUT_BYTES
    {
        return 1;
    }

    let memory_bytes = wasm_memory_bytes();
    if !range_is_valid(password_pointer, password_length, memory_bytes)
        || !range_is_valid(salt_pointer, salt_length, memory_bytes)
        || !range_is_valid(output_pointer, output_length, memory_bytes)
        || ranges_overlap(
            password_pointer,
            password_length,
            output_pointer,
            output_length,
        )
        || ranges_overlap(salt_pointer, salt_length, output_pointer, output_length)
    {
        return 1;
    }

    let password = unsafe {
        core::slice::from_raw_parts(
            password_pointer as usize as *const u8,
            password_length as usize,
        )
    };
    let salt = unsafe {
        core::slice::from_raw_parts(salt_pointer as usize as *const u8, required_salt_length)
    };
    let output = unsafe {
        core::slice::from_raw_parts_mut(output_pointer as usize as *mut u8, OUTPUT_BYTES)
    };
    output.fill(0);

    derive_bytes(password, salt, memory_kib, iterations, parallelism, output)
}

#[cfg(target_arch = "wasm32")]
fn wasm_memory_bytes() -> usize {
    (core::arch::wasm32::memory_size(0) as usize)
        .checked_mul(65_536)
        .unwrap_or(0)
}

#[cfg(not(target_arch = "wasm32"))]
fn wasm_memory_bytes() -> usize {
    u32::MAX as usize
}

fn range_is_valid(pointer: u32, length: u32, memory_bytes: usize) -> bool {
    let start = pointer as usize;
    start
        .checked_add(length as usize)
        .is_some_and(|end| end <= memory_bytes)
}

fn ranges_overlap(
    left_pointer: u32,
    left_length: u32,
    right_pointer: u32,
    right_length: u32,
) -> bool {
    let left_start = left_pointer as u64;
    let right_start = right_pointer as u64;
    let left_end = left_start + left_length as u64;
    let right_end = right_start + right_length as u64;
    left_start < right_end && right_start < left_end
}

fn derive_bytes(
    password: &[u8],
    salt: &[u8],
    memory_kib: u32,
    iterations: u32,
    parallelism: u32,
    output: &mut [u8],
) -> i32 {
    if password.len() > PASSWORD_LIMIT
        || !(8..=SALT_BYTES).contains(&salt.len())
        || output.len() != OUTPUT_BYTES
    {
        return 1;
    }
    output.fill(0);
    let Ok(params) = Params::new(memory_kib, iterations, parallelism, Some(OUTPUT_BYTES)) else {
        return 1;
    };
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    match argon2.hash_password_into(password, salt, output) {
        Ok(()) => 0,
        Err(_) => {
            output.fill(0);
            2
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_rustcrypto_argon2id_v13_known_answer() {
        let mut output = [0_u8; OUTPUT_BYTES];
        let params = Params::new(65_536, 2, 1, Some(OUTPUT_BYTES)).unwrap();
        let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
        argon2
            .hash_password_into(b"password", b"somesalt", &mut output)
            .unwrap();
        assert_eq!(
            output,
            [
                0x09, 0x31, 0x61, 0x15, 0xd5, 0xcf, 0x24, 0xed, 0x5a, 0x15, 0xa3, 0x1a, 0x3b, 0xa3,
                0x26, 0xe5, 0xcf, 0x32, 0xed, 0xc2, 0x47, 0x02, 0x98, 0x7c, 0x02, 0xb6, 0x56, 0x6f,
                0x61, 0x91, 0x3c, 0xf7,
            ]
        );
    }

    #[test]
    fn candidate_tuple_is_fixed() {
        let mut output = [0_u8; OUTPUT_BYTES];
        let status = derive_bytes(
            b"password",
            b"0123456789abcdef",
            MEMORY_KIB,
            ITERATIONS,
            LEGACY_PARALLELISM,
            &mut output,
        );
        assert_eq!(status, 0);
        assert_ne!(output, [0; OUTPUT_BYTES]);
    }

    #[test]
    fn matches_pdv_proposed_argon2id_tuple_known_answer() {
        let mut output = [0_u8; OUTPUT_BYTES];
        let status = derive_bytes(
            b"password",
            b"0123456789abcdef",
            MEMORY_KIB,
            ITERATIONS,
            LEGACY_PARALLELISM,
            &mut output,
        );

        assert_eq!(status, 0);
        assert_eq!(
            output,
            [
                0xda, 0xf1, 0x67, 0x80, 0xdc, 0xb7, 0x3e, 0x86, 0x21, 0x46, 0x29, 0x7f, 0xa1, 0x7b,
                0x81, 0xb8, 0x6b, 0x48, 0x0f, 0x33, 0xc0, 0xb6, 0x7d, 0xae, 0xf0, 0xf2, 0xc7, 0xc8,
                0x09, 0xc5, 0x79, 0x7b,
            ]
        );
    }

    #[test]
    fn empty_password_bytes_are_supported() {
        let mut output = [0_u8; OUTPUT_BYTES];
        let status = derive_bytes(
            b"",
            b"0123456789abcdef",
            MEMORY_KIB,
            ITERATIONS,
            CURRENT_PARALLELISM,
            &mut output,
        );
        assert_eq!(status, 0);
        assert_ne!(output, [0; OUTPUT_BYTES]);
    }

    #[test]
    fn matches_pdv_p4_known_answer() {
        let mut output = [0_u8; OUTPUT_BYTES];
        let status = derive_bytes(
            b"password",
            b"0123456789abcdef",
            MEMORY_KIB,
            ITERATIONS,
            CURRENT_PARALLELISM,
            &mut output,
        );
        assert_eq!(status, 0);
        assert_eq!(
            output,
            [
                0xb8, 0xa6, 0x4b, 0x68, 0xde, 0xa6, 0xb8, 0x8c, 0xa8, 0xc8, 0x86, 0x2b, 0xe7, 0x06,
                0xaa, 0xc3, 0x7c, 0xbe, 0xcd, 0xa0, 0xdb, 0x7b, 0xd6, 0x8b, 0x48, 0xf8, 0xfa, 0x2e,
                0x7f, 0xeb, 0x6f, 0x3e,
            ]
        );
    }
}
