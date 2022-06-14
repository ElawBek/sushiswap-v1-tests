interface RSV {
  r: string;
  s: string;
  v: number;
}

export const splitSignatureToRSV = (signature: string): RSV => {
  const r = "0x" + signature.substring(2).substring(0, 64);
  const s = "0x" + signature.substring(2).substring(64, 128);
  const v = parseInt(signature.substring(2).substring(128, 130), 16);
  return { r, s, v };
};

export const getEIP712Domain = async (contract: any, signer: any) => {
  return {
    name: await contract.name(),
    chainId: await signer.getChainId(),
    verifyingContract: contract.address,
  };
};
