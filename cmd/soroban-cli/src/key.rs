use clap::arg;
use soroban_env_host::xdr::{
    self, LedgerKey, LedgerKeyContractCode, LedgerKeyContractData, ReadXdr, ScAddress, ScVal,
};
use std::path::PathBuf;

use crate::{
    commands::contract::Durability,
    utils::{self},
    wasm,
};

#[derive(thiserror::Error, Debug)]
pub enum Error {
    #[error(transparent)]
    Spec(#[from] soroban_spec_tools::Error),
    #[error(transparent)]
    Xdr(#[from] xdr::Error),
    #[error("cannot parse contract ID {0}: {1}")]
    CannotParseContractId(String, stellar_strkey::DecodeError),
    #[error(transparent)]
    Wasm(#[from] wasm::Error),
}

#[derive(Debug, clap::Args, Clone)]
#[group(skip)]
pub struct Args {
    /// Contract ID to which owns the data entries.
    /// If no keys provided the Contract's instance will be bumped
    #[arg(
        long = "id",
        required_unless_present = "wasm",
        required_unless_present = "wasm_hash"
    )]
    pub contract_id: Option<String>,
    /// Storage key (symbols only)
    #[arg(long = "key", conflicts_with = "key_xdr")]
    pub key: Option<Vec<String>>,
    /// Storage key (base64-encoded XDR)
    #[arg(long = "key-xdr", conflicts_with = "key")]
    pub key_xdr: Option<Vec<String>>,
    /// Path to Wasm file of contract code to bump
    #[arg(
        long,
        conflicts_with = "contract_id",
        conflicts_with = "key",
        conflicts_with = "key_xdr",
        conflicts_with = "wasm_hash"
    )]
    pub wasm: Option<PathBuf>,
    /// Path to Wasm file of contract code to bump
    #[arg(
        long,
        conflicts_with = "contract_id",
        conflicts_with = "key",
        conflicts_with = "key_xdr",
        conflicts_with = "wasm"
    )]
    pub wasm_hash: Option<String>,
    /// Storage entry durability
    #[arg(long, value_enum, required = true)]
    pub durability: Durability,
}

impl Args {
    pub fn parse_keys(&self) -> Result<Vec<LedgerKey>, Error> {
        let keys = if let Some(keys) = &self.key {
            keys.iter()
                .map(|key| {
                    Ok(soroban_spec_tools::from_string_primitive(
                        key,
                        &xdr::ScSpecTypeDef::Symbol,
                    )?)
                })
                .collect::<Result<Vec<_>, Error>>()?
        } else if let Some(keys) = &self.key_xdr {
            keys.iter()
                .map(|s| Ok(ScVal::from_xdr_base64(s)?))
                .collect::<Result<Vec<_>, Error>>()?
        } else if let Some(wasm) = &self.wasm {
            return Ok(vec![crate::wasm::Args { wasm: wasm.clone() }.try_into()?]);
        } else if let Some(wasm_hash) = &self.wasm_hash {
            return Ok(vec![LedgerKey::ContractCode(LedgerKeyContractCode {
                hash: xdr::Hash(
                    utils::contract_id_from_str(wasm_hash)
                        .map_err(|e| Error::CannotParseContractId(wasm_hash.clone(), e))?,
                ),
            })]);
        } else {
            vec![ScVal::LedgerKeyContractInstance]
        };
        let contract_id = contract_id(self.contract_id.as_ref().unwrap())?;

        Ok(keys
            .into_iter()
            .map(|key| {
                LedgerKey::ContractData(LedgerKeyContractData {
                    contract: ScAddress::Contract(xdr::Hash(contract_id)),
                    durability: (&self.durability).into(),
                    key,
                })
            })
            .collect())
    }
}

fn contract_id(s: &str) -> Result<[u8; 32], Error> {
    utils::contract_id_from_str(s).map_err(|e| Error::CannotParseContractId(s.to_string(), e))
}
