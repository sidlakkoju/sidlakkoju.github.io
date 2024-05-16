import React from 'react';

const Header: React.FC = () => {
  return (
    <header className="bg-white dark:bg-gray-800 text-black dark:text-white p-4 rounded-lg shadow-lg mx-auto mt-2 w-11/12">
      <div className="container mx-auto flex justify-between items-center">
        <h1 className="text-2xl">Sid Lakkoju</h1>
      </div>
    </header>
  );
};

export default Header;
